import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

export const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function slugifyName(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return base || "voyageur";
}

function credentialsFromDisplayName(name: string) {
  const slug = slugifyName(name);
  return {
    email: `${slug}@vanlife.local`,
    password: `vanlife-${slug}-roadtrip-2026`,
  };
}

// API Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", mode: process.env.NODE_ENV || "development" });
});

/**
 * Name-only login helper. When SUPABASE_SERVICE_ROLE_KEY is set, creates/updates
 * a confirmed auth user so the client can sign in without email confirmation.
 */
app.post("/api/auth/name-login", async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (name.length < 2) {
    return res.status(400).json({ error: "Prénom requis" });
  }

  const url = stripQuotes(process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "");
  const serviceKey = stripQuotes(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || ""
  );
  const { email, password } = credentialsFromDisplayName(name);

  if (!url || !serviceKey) {
    return res.json({ email, password, mode: "client" });
  }

  try {
    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (created.error) {
      const msg = (created.error.message || "").toLowerCase();
      const alreadyExists =
        msg.includes("already") || msg.includes("registered") || msg.includes("exists");
      if (!alreadyExists) {
        return res.status(500).json({ error: created.error.message });
      }

      const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = (listed.data?.users ?? []).find((u: any) => u.email === email);
      if (existing) {
        await admin.auth.admin.updateUserById(existing.id, {
          password,
          email_confirm: true,
          user_metadata: { name },
        });
      }
    }

    return res.json({ email, password, mode: "service" });
  } catch (err: any) {
    console.error("name-login error:", err);
    return res.json({ email, password, mode: "client" });
  }
});

// Supabase Config status check
app.get("/api/supabase/status", (req, res) => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  res.json({
    configured: Boolean(url && key),
    message: url && key
      ? "Cloud configuré."
      : "Mode local actif.",
  });
});

type OsmTags = Record<string, string>;

const vanSpotCache = new Map<string, { expiresAt: number; payload: unknown }>();
const francePlaceCache = new Map<string, { expiresAt: number; payload: unknown }>();

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radius = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function yesNo(value?: string) {
  if (!value) return undefined;
  if (["yes", "designated", "permissive"].includes(value)) return true;
  if (["no", "private"].includes(value)) return false;
  return undefined;
}

function classifyVanSpot(tags: OsmTags) {
  if (tags.amenity === "motorhome_stopover") {
    return { type: "motorhome_stopover", label: "Aire camping-car", confidence: "official", score: 1200 };
  }
  if (tags.tourism === "caravan_site") {
    return { type: "caravan_site", label: "Aire / camping-car", confidence: "official", score: 1150 };
  }
  if (tags.tourism === "camp_site") {
    return { type: "camp_site", label: "Camping", confidence: "official", score: 1080 };
  }
  if (tags.highway === "rest_area") {
    return { type: "rest_area", label: "Aire de repos", confidence: "likely", score: 760 };
  }
  if (tags.tourism === "picnic_site") {
    return { type: "picnic_site", label: "Aire de pique-nique", confidence: "verify", score: 500 };
  }
  const motorhome = tags.motorhome || tags.caravan;
  if (motorhome === "yes" || motorhome === "designated") {
    return { type: "van_parking", label: "Parking van signalé", confidence: "likely", score: 820 };
  }
  return { type: "parking", label: "Parking à vérifier", confidence: "verify", score: 350 };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/france-places/suggest", async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 80);
  if (query.length < 2) return res.json({ places: [] });

  const cacheKey = query.toLocaleLowerCase("fr");
  const cached = francePlaceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.payload);

  try {
    const url = new URL("https://geo.api.gouv.fr/communes");
    url.searchParams.set("nom", query);
    url.searchParams.set("fields", "nom,code,codesPostaux,centre,departement,region,population");
    url.searchParams.set("boost", "population");
    url.searchParams.set("limit", "10");
    const communes = await fetchJson(url.toString(), {
      headers: { "User-Agent": "VanlifeClub/1.0 (internal road-trip planner)" },
    }, 8_000) as any[];

    const payload = {
      places: communes
        .filter((commune) => Array.isArray(commune.centre?.coordinates))
        .map((commune) => ({
          id: commune.code,
          name: commune.nom,
          postalCode: commune.codesPostaux?.[0] || "",
          department: commune.departement?.nom || "",
          region: commune.region?.nom || "",
          population: commune.population || 0,
          lat: commune.centre.coordinates[1],
          lng: commune.centre.coordinates[0],
          label: `${commune.nom}${commune.codesPostaux?.[0] ? ` (${commune.codesPostaux[0]})` : ""} · ${commune.departement?.nom || commune.region?.nom || "France"}`,
        })),
    };
    francePlaceCache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60_000, payload });
    return res.json(payload);
  } catch (error) {
    console.error("France places suggestion error:", error);
    return res.status(502).json({ error: "La liste des communes est momentanément indisponible." });
  }
});

app.get("/api/van-spots/search", async (req, res) => {
  const query = String(req.query.q || "").trim().slice(0, 100);
  const radiusKm = Math.max(5, Math.min(40, Number(req.query.radius) || 20));
  const suppliedLat = Number(req.query.lat);
  const suppliedLng = Number(req.query.lng);
  const hasSuppliedCoordinates = Number.isFinite(suppliedLat) && Number.isFinite(suppliedLng);
  if (query.length < 2) return res.status(400).json({ error: "Indique une ville ou un village." });

  const cacheKey = `${query.toLocaleLowerCase("fr")}:${hasSuppliedCoordinates ? `${suppliedLat.toFixed(4)},${suppliedLng.toFixed(4)}` : "geo"}:${radiusKm}`;
  const cached = vanSpotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.payload);

  try {
    let place: any;
    let lat: number;
    let lng: number;
    if (hasSuppliedCoordinates) {
      lat = suppliedLat;
      lng = suppliedLng;
      place = { display_name: String(req.query.label || query), type: "commune" };
    } else {
      const geocodingUrl = new URL("https://nominatim.openstreetmap.org/search");
      geocodingUrl.searchParams.set("q", `${query}, France`);
      geocodingUrl.searchParams.set("countrycodes", "fr");
      geocodingUrl.searchParams.set("format", "jsonv2");
      geocodingUrl.searchParams.set("addressdetails", "1");
      geocodingUrl.searchParams.set("limit", "1");
      geocodingUrl.searchParams.set("accept-language", "fr");
      const geocoding = await fetchJson(geocodingUrl.toString(), {
        headers: {
          "User-Agent": "VanlifeClub/1.0 (internal road-trip planner)",
          "Accept-Language": "fr",
        },
      }, 10_000) as any[];
      if (!geocoding.length) return res.status(404).json({ error: "Ville ou village introuvable." });
      place = geocoding[0];
      lat = Number(place.lat);
      lng = Number(place.lon);
    }
    const radiusMeters = Math.round(radiusKm * 1000);
    const overpassQuery = `[out:json][timeout:25];
(
  nwr(around:${radiusMeters},${lat},${lng})["amenity"="motorhome_stopover"];
  nwr(around:${radiusMeters},${lat},${lng})["tourism"~"^(camp_site|caravan_site|picnic_site)$"];
  nwr(around:${radiusMeters},${lat},${lng})["highway"="rest_area"];
  nwr(around:${radiusMeters},${lat},${lng})["amenity"="parking"]["motorhome"~"^(yes|designated)$"];
);
out center tags 120;`;

    let overpass: any = null;
    const overpassEndpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
    ];
    for (const endpoint of overpassEndpoints) {
      try {
        overpass = await fetchJson(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "VanlifeClub/1.0 (internal road-trip planner)",
            "Accept": "application/json",
          },
          body: new URLSearchParams({ data: overpassQuery }),
        }, 32_000);
        break;
      } catch (error) {
        console.warn(`Overpass failed (${endpoint}):`, error);
      }
    }
    if (!overpass) throw new Error("Les données cartographiques sont momentanément indisponibles.");

    const spots = (overpass.elements || [])
      .map((element: any) => {
        const tags = (element.tags || {}) as OsmTags;
        const spotLat = Number(element.lat ?? element.center?.lat);
        const spotLng = Number(element.lon ?? element.center?.lon);
        if (!Number.isFinite(spotLat) || !Number.isFinite(spotLng)) return null;
        const classification = classifyVanSpot(tags);
        const distance = distanceKm(lat, lng, spotLat, spotLng);
        const amenityFlags = [
          tags.drinking_water === "yes" || tags.water_point === "yes" ? "Eau potable" : null,
          tags.toilets === "yes" ? "Toilettes" : null,
          tags.shower === "yes" ? "Douches" : null,
          tags.electricity === "yes" || tags.power_supply === "yes" ? "Électricité" : null,
          tags.sanitary_dump_station === "yes" ? "Vidange" : null,
          tags.waste_disposal === "yes" ? "Poubelles" : null,
          tags.internet_access === "wlan" || tags.internet_access === "yes" ? "Wi-Fi" : null,
        ].filter(Boolean);
        const detailsCount = amenityFlags.length + ["fee", "opening_hours", "capacity", "website", "phone"]
          .filter((key) => tags[key]).length;
        return {
          id: `${element.type}-${element.id}`,
          osmType: element.type,
          osmId: element.id,
          name: tags.name || tags["name:fr"] || classification.label,
          ...classification,
          lat: spotLat,
          lng: spotLng,
          distanceKm: Number(distance.toFixed(1)),
          score: classification.score + detailsCount * 18 + (tags.name ? 35 : 0) - distance * 3,
          address: [
            tags["addr:housenumber"],
            tags["addr:street"],
            tags["addr:place"],
            tags["addr:city"],
          ].filter(Boolean).join(" ") || undefined,
          amenities: amenityFlags,
          fee: tags.fee,
          feeAmount: tags.charge,
          openingHours: tags.opening_hours,
          capacity: tags.capacity || tags["capacity:caravans"],
          maxstay: tags.maxstay,
          access: tags.access,
          surface: tags.surface,
          lit: yesNo(tags.lit),
          reservation: tags.reservation,
          website: tags.website || tags["contact:website"],
          phone: tags.phone || tags["contact:phone"],
          operator: tags.operator,
          description: tags.description || tags.note,
          sourceUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
          navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${spotLat},${spotLng}`,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 80)
      .map(({ score, ...spot }: any) => spot);

    const payload = {
      query,
      place: {
        name: place.display_name,
        lat,
        lng,
        type: place.type,
      },
      radiusKm,
      count: spots.length,
      spots,
      attribution: "Données © contributeurs OpenStreetMap, recherche Overpass",
      notice: "Vérifie toujours la signalisation locale. Un parking public n’autorise pas nécessairement le stationnement de nuit.",
    };
    vanSpotCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, payload });
    return res.json(payload);
  } catch (error: any) {
    console.error("van-spots search error:", error);
    return res.status(502).json({
      error: error?.name === "AbortError"
        ? "La recherche a pris trop de temps. Réessaie."
        : error?.message || "Recherche de spots indisponible.",
    });
  }
});

async function main() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VanLife GPS App active sur http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  void main();
}

export default app;

import express from "express";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  buildVanSpotOverpassQuery,
  mapOverpassToSpots,
  shortPlaceName,
} from "./src/services/vanSpotEngine";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

export const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Vercel may invoke /api with a stripped path (/van-spots/...). Normalize it.
app.use((req, _res, next) => {
  if (!process.env.VERCEL) return next();
  const url = req.url || "";
  const pathOnly = url.split("?")[0] || "";
  if (pathOnly === "/api" || pathOnly.startsWith("/api/")) return next();
  if (
    pathOnly.startsWith("/van-spots") ||
    pathOnly.startsWith("/france-places") ||
    pathOnly.startsWith("/auth") ||
    pathOnly === "/health" ||
    pathOnly.startsWith("/supabase")
  ) {
    req.url = `/api${url.startsWith("/") ? url : `/${url}`}`;
  }
  next();
});

// Avoid caching API responses on mobile / PWA.
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

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

const vanSpotCache = new Map<string, { expiresAt: number; payload: unknown }>();
const francePlaceCache = new Map<string, { expiresAt: number; payload: unknown }>();

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

  const cacheKey = `${query.toLocaleLowerCase("fr")}:${hasSuppliedCoordinates ? `${suppliedLat.toFixed(4)},${suppliedLng.toFixed(4)}` : "geo"}:${radiusKm}:v2`;
  const cached = vanSpotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return res.json(cached.payload);

  try {
    let placeName: string;
    let placeType = "commune";
    let lat: number;
    let lng: number;

    if (hasSuppliedCoordinates) {
      lat = suppliedLat;
      lng = suppliedLng;
      placeName = shortPlaceName(String(req.query.label || query), query);
      placeType = String(req.query.label || "").toLowerCase().includes("position") ? "gps" : "commune";
    } else {
      const geoUrl = new URL("https://geo.api.gouv.fr/communes");
      geoUrl.searchParams.set("nom", query);
      geoUrl.searchParams.set("fields", "nom,centre,population");
      geoUrl.searchParams.set("boost", "population");
      geoUrl.searchParams.set("limit", "5");
      const communes = await fetchJson(geoUrl.toString(), {
        headers: { "User-Agent": "VanlifeClub/1.0 (internal road-trip planner)" },
      }, 10_000) as Array<{ nom?: string; population?: number; centre?: { coordinates?: [number, number] } }>;

      const normalized = query.toLocaleLowerCase("fr");
      const ranked = communes
        .filter((item) => Array.isArray(item.centre?.coordinates))
        .sort((a, b) => {
          const aExact = (a.nom || "").toLocaleLowerCase("fr") === normalized ? 1 : 0;
          const bExact = (b.nom || "").toLocaleLowerCase("fr") === normalized ? 1 : 0;
          if (aExact !== bExact) return bExact - aExact;
          return (b.population || 0) - (a.population || 0);
        });
      const commune = ranked[0];
      if (!commune?.centre?.coordinates) {
        return res.status(404).json({ error: "Ville ou village introuvable." });
      }
      placeName = commune.nom || query;
      lat = commune.centre.coordinates[1];
      lng = commune.centre.coordinates[0];
    }

    const overpassQuery = buildVanSpotOverpassQuery(lat, lng, Math.round(radiusKm * 1000));
    let overpass: { elements?: unknown[] } | null = null;
    const overpassEndpoints = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
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
        }, 32_000) as { elements?: unknown[] };
        break;
      } catch (error) {
        console.warn(`Overpass failed (${endpoint}):`, error);
      }
    }
    if (!overpass) throw new Error("Les données cartographiques sont momentanément indisponibles.");

    const spots = mapOverpassToSpots(overpass.elements || [], lat, lng);
    const payload = {
      query,
      place: {
        name: placeName,
        lat,
        lng,
        type: placeType,
      },
      radiusKm,
      count: spots.length,
      spots,
      attribution: "Données © contributeurs OpenStreetMap",
      notice: "Priorité aux aires et parkings van recensés. Vérifie toujours panneau et règlement local avant de dormir.",
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
  // Dynamic import keeps `vite` out of the Vercel serverless bundle.
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // JSON 404 for unmatched API routes (avoids HTML "Cannot GET /api/...").
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Route API introuvable." });
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`VanLife GPS App active sur http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  void main();
} else {
  // Same JSON 404 when running as a Vercel serverless function.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Route API introuvable." });
  });
}

export default app;

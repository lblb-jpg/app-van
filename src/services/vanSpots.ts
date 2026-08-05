import type { FrancePlace, VanSleepSearchResult, VanSleepSpot } from '../types';

type OsmTags = Record<string, string>;

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function yesNo(value?: string) {
  if (!value) return undefined;
  if (['yes', 'designated', 'permissive'].includes(value)) return true;
  if (['no', 'private'].includes(value)) return false;
  return undefined;
}

function classifyVanSpot(tags: OsmTags) {
  if (tags.amenity === 'motorhome_stopover') {
    return { type: 'motorhome_stopover' as const, label: 'Aire camping-car', confidence: 'official' as const, score: 1200 };
  }
  if (tags.tourism === 'caravan_site') {
    return { type: 'caravan_site' as const, label: 'Aire / camping-car', confidence: 'official' as const, score: 1150 };
  }
  if (tags.tourism === 'camp_site') {
    return { type: 'camp_site' as const, label: 'Camping', confidence: 'official' as const, score: 1080 };
  }
  if (tags.highway === 'rest_area') {
    return { type: 'rest_area' as const, label: 'Aire de repos', confidence: 'likely' as const, score: 760 };
  }
  if (tags.tourism === 'picnic_site') {
    return { type: 'picnic_site' as const, label: 'Aire de pique-nique', confidence: 'verify' as const, score: 500 };
  }
  const motorhome = tags.motorhome || tags.caravan;
  if (motorhome === 'yes' || motorhome === 'designated') {
    return { type: 'van_parking' as const, label: 'Parking van signalé', confidence: 'likely' as const, score: 820 };
  }
  return { type: 'parking' as const, label: 'Parking à vérifier', confidence: 'verify' as const, score: 350 };
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('json')) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function readApiPayload(response: Response): Promise<Record<string, unknown> | null> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return null;
  const payload = await response.json().catch(() => null);
  return isRecord(payload) ? payload : null;
}

function normalizeSpot(raw: unknown, index: number): VanSleepSpot | null {
  if (!isRecord(raw)) return null;
  const lat = Number(raw.lat);
  const lng = Number(raw.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const amenities = Array.isArray(raw.amenities)
    ? raw.amenities.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    id: typeof raw.id === 'string' ? raw.id : `spot-${index}`,
    osmType: raw.osmType === 'way' || raw.osmType === 'relation' ? raw.osmType : 'node',
    osmId: Number(raw.osmId) || index,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Lieu sans nom',
    type: (raw.type as VanSleepSpot['type']) || 'parking',
    label: typeof raw.label === 'string' && raw.label ? raw.label : 'Spot van',
    confidence: raw.confidence === 'official' || raw.confidence === 'likely' ? raw.confidence : 'verify',
    lat,
    lng,
    distanceKm: Number.isFinite(Number(raw.distanceKm)) ? Number(raw.distanceKm) : 0,
    address: typeof raw.address === 'string' ? raw.address : undefined,
    amenities,
    fee: typeof raw.fee === 'string' ? raw.fee : undefined,
    feeAmount: typeof raw.feeAmount === 'string' ? raw.feeAmount : undefined,
    openingHours: typeof raw.openingHours === 'string' ? raw.openingHours : undefined,
    capacity: typeof raw.capacity === 'string' ? raw.capacity : undefined,
    maxstay: typeof raw.maxstay === 'string' ? raw.maxstay : undefined,
    access: typeof raw.access === 'string' ? raw.access : undefined,
    surface: typeof raw.surface === 'string' ? raw.surface : undefined,
    lit: typeof raw.lit === 'boolean' ? raw.lit : undefined,
    reservation: typeof raw.reservation === 'string' ? raw.reservation : undefined,
    website: typeof raw.website === 'string' ? raw.website : undefined,
    phone: typeof raw.phone === 'string' ? raw.phone : undefined,
    operator: typeof raw.operator === 'string' ? raw.operator : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}`,
    navigationUrl: typeof raw.navigationUrl === 'string'
      ? raw.navigationUrl
      : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  };
}

function normalizeSearchResult(payload: Record<string, unknown>, query: string, radiusKm: number): VanSleepSearchResult {
  const placeRaw = isRecord(payload.place) ? payload.place : {};
  const spots = (Array.isArray(payload.spots) ? payload.spots : [])
    .map((spot, index) => normalizeSpot(spot, index))
    .filter((spot): spot is VanSleepSpot => !!spot);

  return {
    query: typeof payload.query === 'string' ? payload.query : query,
    place: {
      name: typeof placeRaw.name === 'string' && placeRaw.name ? placeRaw.name : query,
      lat: Number(placeRaw.lat) || 0,
      lng: Number(placeRaw.lng) || 0,
      type: typeof placeRaw.type === 'string' ? placeRaw.type : 'place',
    },
    radiusKm: Number(payload.radiusKm) || radiusKm,
    count: typeof payload.count === 'number' ? payload.count : spots.length,
    spots,
    attribution: typeof payload.attribution === 'string'
      ? payload.attribution
      : 'Données © contributeurs OpenStreetMap',
    notice: typeof payload.notice === 'string'
      ? payload.notice
      : 'Vérifie toujours la signalisation locale avant de dormir sur place.',
  };
}

async function geocodeFrenchPlace(query: string, signal?: AbortSignal) {
  const url = new URL('https://geo.api.gouv.fr/communes');
  url.searchParams.set('nom', query);
  url.searchParams.set('fields', 'nom,code,codesPostaux,centre,departement,region,population');
  url.searchParams.set('boost', 'population');
  url.searchParams.set('limit', '1');
  const communes = (await fetchJson(url.toString(), {}, 10_000, signal)) as Array<{
    nom?: string;
    centre?: { coordinates?: [number, number] };
  }>;
  const commune = communes.find((item) => Array.isArray(item.centre?.coordinates));
  if (!commune?.centre?.coordinates) throw new Error('Ville ou village introuvable.');
  return {
    name: commune.nom || query,
    lat: commune.centre.coordinates[1],
    lng: commune.centre.coordinates[0],
    type: 'commune',
  };
}

function mapOverpassElements(
  elements: unknown[],
  originLat: number,
  originLng: number
): VanSleepSpot[] {
  const ranked: Array<{ spot: VanSleepSpot; score: number }> = [];

  for (const [index, element] of elements.entries()) {
    if (!isRecord(element)) continue;
    const tags = (isRecord(element.tags) ? element.tags : {}) as OsmTags;
    const center = isRecord(element.center) ? element.center : null;
    const spotLat = Number(element.lat ?? center?.lat);
    const spotLng = Number(element.lon ?? center?.lon);
    if (!Number.isFinite(spotLat) || !Number.isFinite(spotLng)) continue;
    const classification = classifyVanSpot(tags);
    const distance = distanceKm(originLat, originLng, spotLat, spotLng);
    const amenityFlags = [
      tags.drinking_water === 'yes' || tags.water_point === 'yes' ? 'Eau potable' : null,
      tags.toilets === 'yes' ? 'Toilettes' : null,
      tags.shower === 'yes' ? 'Douches' : null,
      tags.electricity === 'yes' || tags.power_supply === 'yes' ? 'Électricité' : null,
      tags.sanitary_dump_station === 'yes' ? 'Vidange' : null,
      tags.waste_disposal === 'yes' ? 'Poubelles' : null,
      tags.internet_access === 'wlan' || tags.internet_access === 'yes' ? 'Wi-Fi' : null,
    ].filter((item): item is string => !!item);
    const detailsCount =
      amenityFlags.length +
      ['fee', 'opening_hours', 'capacity', 'website', 'phone'].filter((key) => tags[key]).length;
    const score = classification.score + detailsCount * 18 + (tags.name ? 35 : 0) - distance * 3;
    const osmType = element.type === 'way' || element.type === 'relation' ? element.type : 'node';
    const osmId = Number(element.id) || index;
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:place'], tags['addr:city']]
      .filter(Boolean)
      .join(' ');
    ranked.push({
      score,
      spot: {
        id: `${osmType}-${osmId}`,
        osmType,
        osmId,
        name: tags.name || tags['name:fr'] || classification.label,
        type: classification.type,
        label: classification.label,
        confidence: classification.confidence,
        lat: spotLat,
        lng: spotLng,
        distanceKm: Number(distance.toFixed(1)),
        address: address || undefined,
        amenities: amenityFlags,
        fee: tags.fee,
        feeAmount: tags.charge,
        openingHours: tags.opening_hours,
        capacity: tags.capacity || tags['capacity:caravans'],
        maxstay: tags.maxstay,
        access: tags.access,
        surface: tags.surface,
        lit: yesNo(tags.lit),
        reservation: tags.reservation,
        website: tags.website || tags['contact:website'],
        phone: tags.phone || tags['contact:phone'],
        operator: tags.operator,
        description: tags.description || tags.note,
        sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
        navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${spotLat},${spotLng}`,
      },
    });
  }

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 80)
    .map(({ spot }) => spot);
}

async function searchVanSleepSpotsDirect(
  query: string,
  radiusKm: number,
  place?: Pick<FrancePlace, 'lat' | 'lng' | 'label' | 'name'>,
  signal?: AbortSignal
): Promise<VanSleepSearchResult> {
  let lat: number;
  let lng: number;
  let placeName: string;
  let placeType = 'commune';

  if (place && Number.isFinite(place.lat) && Number.isFinite(place.lng)) {
    lat = place.lat;
    lng = place.lng;
    placeName = place.label || place.name || query;
  } else {
    const geocoded = await geocodeFrenchPlace(query, signal);
    lat = geocoded.lat;
    lng = geocoded.lng;
    placeName = geocoded.name;
    placeType = geocoded.type;
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

  let overpass: { elements?: unknown[] } | null = null;
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      // GET avoids CORS preflight and works from phones / static hosts.
      const getUrl = `${endpoint}?data=${encodeURIComponent(overpassQuery)}`;
      overpass = (await fetchJson(getUrl, { method: 'GET', headers: { Accept: 'application/json' } }, 32_000, signal)) as {
        elements?: unknown[];
      };
      break;
    } catch (error) {
      lastError = error;
      try {
        overpass = (await fetchJson(
          endpoint,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: new URLSearchParams({ data: overpassQuery }),
          },
          32_000,
          signal
        )) as { elements?: unknown[] };
        break;
      } catch (postError) {
        lastError = postError;
      }
    }
  }

  if (!overpass) {
    if ((lastError as DOMException)?.name === 'AbortError') throw lastError;
    throw new Error('Les données cartographiques sont momentanément indisponibles.');
  }

  const spots = mapOverpassElements(overpass.elements || [], lat, lng);
  return {
    query,
    place: { name: placeName, lat, lng, type: placeType },
    radiusKm,
    count: spots.length,
    spots,
    attribution: 'Données © contributeurs OpenStreetMap, recherche Overpass',
    notice:
      'Vérifie toujours la signalisation locale. Un parking public n’autorise pas nécessairement le stationnement de nuit.',
  };
}

/** Prefer backend cache when available; otherwise query public APIs from the phone. */
export async function searchVanSleepSpots(
  query: string,
  radiusKm: number,
  place?: Pick<FrancePlace, 'lat' | 'lng' | 'label' | 'name'>,
  signal?: AbortSignal
): Promise<VanSleepSearchResult> {
  const trimmed = query.trim();
  const params = new URLSearchParams({
    q: trimmed,
    radius: String(radiusKm),
  });
  if (place) {
    params.set('lat', String(place.lat));
    params.set('lng', String(place.lng));
    params.set('label', place.label || place.name || trimmed);
  }

  try {
    const response = await fetch(`/api/van-spots/search?${params}`, { signal });
    const payload = await readApiPayload(response);
    if (payload && response.ok) return normalizeSearchResult(payload, trimmed, radiusKm);
    if (payload && !response.ok && typeof payload.error === 'string') {
      // Backend reachable with a real product error — don't mask it.
      if (response.status === 400 || response.status === 404) throw new Error(payload.error);
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') throw error;
    // Fall through to direct public APIs (static / AI Studio / broken /api).
  }

  return searchVanSleepSpotsDirect(trimmed, radiusKm, place, signal);
}

export async function suggestFrenchPlaces(query: string, signal?: AbortSignal): Promise<FrancePlace[]> {
  const trimmed = query.trim();
  try {
    const response = await fetch(`/api/france-places/suggest?q=${encodeURIComponent(trimmed)}`, { signal });
    const payload = await readApiPayload(response);
    if (payload && response.ok) {
      return (Array.isArray(payload.places) ? payload.places : []) as FrancePlace[];
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') throw error;
  }

  const url = new URL('https://geo.api.gouv.fr/communes');
  url.searchParams.set('nom', trimmed);
  url.searchParams.set('fields', 'nom,code,codesPostaux,centre,departement,region,population');
  url.searchParams.set('boost', 'population');
  url.searchParams.set('limit', '10');
  const communes = (await fetchJson(url.toString(), {}, 8_000, signal)) as Array<{
    code: string;
    nom: string;
    codesPostaux?: string[];
    departement?: { nom?: string };
    region?: { nom?: string };
    population?: number;
    centre?: { coordinates?: [number, number] };
  }>;

  return communes
    .filter((commune) => Array.isArray(commune.centre?.coordinates))
    .map((commune) => ({
      id: commune.code,
      name: commune.nom,
      postalCode: commune.codesPostaux?.[0] || '',
      department: commune.departement?.nom || '',
      region: commune.region?.nom || '',
      population: commune.population || 0,
      lat: commune.centre!.coordinates![1],
      lng: commune.centre!.coordinates![0],
      label: `${commune.nom}${commune.codesPostaux?.[0] ? ` (${commune.codesPostaux[0]})` : ''} · ${
        commune.departement?.nom || commune.region?.nom || 'France'
      }`,
    }));
}

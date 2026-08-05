import type { FrancePlace, VanSleepSearchResult, VanSleepSpot } from '../types';
import {
  buildVanSpotOverpassQuery,
  mapOverpassToSpots,
  shortPlaceName,
} from './vanSpotEngine';

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
    sourceUrl:
      typeof raw.sourceUrl === 'string'
        ? raw.sourceUrl
        : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}`,
    navigationUrl:
      typeof raw.navigationUrl === 'string'
        ? raw.navigationUrl
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
  };
}

function normalizeSearchResult(
  payload: Record<string, unknown>,
  query: string,
  radiusKm: number
): VanSleepSearchResult {
  const placeRaw = isRecord(payload.place) ? payload.place : {};
  const spots = (Array.isArray(payload.spots) ? payload.spots : [])
    .map((spot, index) => normalizeSpot(spot, index))
    .filter((spot): spot is VanSleepSpot => !!spot);

  return {
    query: typeof payload.query === 'string' ? payload.query : query,
    place: {
      name: shortPlaceName(
        typeof placeRaw.name === 'string' && placeRaw.name ? placeRaw.name : query,
        query
      ),
      lat: Number(placeRaw.lat) || 0,
      lng: Number(placeRaw.lng) || 0,
      type: typeof placeRaw.type === 'string' ? placeRaw.type : 'place',
    },
    radiusKm: Number(payload.radiusKm) || radiusKm,
    count: typeof payload.count === 'number' ? payload.count : spots.length,
    spots,
    attribution:
      typeof payload.attribution === 'string'
        ? payload.attribution
        : 'Données © contributeurs OpenStreetMap',
    notice:
      typeof payload.notice === 'string'
        ? payload.notice
        : 'Vérifie toujours la signalisation locale avant de dormir sur place.',
  };
}

async function geocodeFrenchPlace(query: string, signal?: AbortSignal) {
  const url = new URL('https://geo.api.gouv.fr/communes');
  url.searchParams.set('nom', query);
  url.searchParams.set('fields', 'nom,code,codesPostaux,centre,departement,region,population');
  url.searchParams.set('boost', 'population');
  url.searchParams.set('limit', '5');
  const communes = (await fetchJson(url.toString(), {}, 10_000, signal)) as Array<{
    nom?: string;
    population?: number;
    centre?: { coordinates?: [number, number] };
  }>;

  const normalized = query.trim().toLocaleLowerCase('fr');
  const ranked = communes
    .filter((item) => Array.isArray(item.centre?.coordinates))
    .sort((a, b) => {
      const aExact = (a.nom || '').toLocaleLowerCase('fr') === normalized ? 1 : 0;
      const bExact = (b.nom || '').toLocaleLowerCase('fr') === normalized ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      return (b.population || 0) - (a.population || 0);
    });

  const commune = ranked[0];
  if (!commune?.centre?.coordinates) throw new Error('Ville ou village introuvable.');
  return {
    name: commune.nom || query,
    lat: commune.centre.coordinates[1],
    lng: commune.centre.coordinates[0],
    type: 'commune',
  };
}

async function queryOverpass(overpassQuery: string, signal?: AbortSignal) {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return (await fetchJson(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: overpassQuery }),
        },
        20_000,
        signal
      )) as { elements?: unknown[] };
    } catch (error) {
      lastError = error;
    }
  }
  if ((lastError as DOMException)?.name === 'AbortError') throw lastError;
  throw new Error('Les données cartographiques sont momentanément indisponibles.');
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
    placeName = shortPlaceName(place.name || place.label || query, query);
    placeType = place.label?.toLowerCase().includes('position') ? 'gps' : 'commune';
  } else {
    const geocoded = await geocodeFrenchPlace(query, signal);
    lat = geocoded.lat;
    lng = geocoded.lng;
    placeName = geocoded.name;
    placeType = geocoded.type;
  }

  const overpass = await queryOverpass(
    buildVanSpotOverpassQuery(lat, lng, Math.round(radiusKm * 1000)),
    signal
  );
  const spots = mapOverpassToSpots(overpass.elements || [], lat, lng);

  return {
    query,
    place: { name: placeName, lat, lng, type: placeType },
    radiusKm,
    count: spots.length,
    spots,
    attribution: 'Données © contributeurs OpenStreetMap',
    notice:
      'Priorité aux aires et parkings van recensés. Vérifie toujours panneau et règlement local avant de dormir.',
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
      if (response.status === 400 || response.status === 404) throw new Error(payload.error);
    }
  } catch (error) {
    if ((error as DOMException)?.name === 'AbortError') throw error;
  }

  return searchVanSleepSpotsDirect(trimmed, radiusKm, place, signal);
}

export async function suggestFrenchPlaces(query: string, signal?: AbortSignal): Promise<FrancePlace[]> {
  const trimmed = query.trim();
  try {
    const response = await fetch(`/api/france-places/suggest?q=${encodeURIComponent(trimmed)}`, {
      signal,
    });
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

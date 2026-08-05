import type { FrancePlace, VanSleepSearchResult } from '../types';
import {
  buildVanSpotOverpassQuery,
  mapOverpassToSpots,
  shortPlaceName,
} from '../services/vanSpotEngine';

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const vanSpotCache = new Map<string, { expiresAt: number; payload: VanSleepSearchResult }>();
const francePlaceCache = new Map<string, { expiresAt: number; payload: { places: FrancePlace[] } }>();

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

async function queryOverpass(overpassQuery: string) {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      return (await fetchJson(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'VanlifeClub/1.0 (internal road-trip planner)',
            Accept: 'application/json',
          },
          body: new URLSearchParams({ data: overpassQuery }),
        },
        28_000
      )) as { elements?: unknown[] };
    } catch (error) {
      lastError = error;
    }
  }
  if ((lastError as Error)?.name === 'AbortError') throw lastError;
  throw new Error('Les données cartographiques sont momentanément indisponibles.');
}

export async function suggestFrancePlaces(query: string) {
  const trimmed = query.trim().slice(0, 80);
  if (trimmed.length < 2) return { places: [] as FrancePlace[] };

  const cacheKey = trimmed.toLocaleLowerCase('fr');
  const cached = francePlaceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  const url = new URL('https://geo.api.gouv.fr/communes');
  url.searchParams.set('nom', trimmed);
  url.searchParams.set('fields', 'nom,code,codesPostaux,centre,departement,region,population');
  url.searchParams.set('boost', 'population');
  url.searchParams.set('limit', '10');
  const communes = (await fetchJson(
    url.toString(),
    { headers: { 'User-Agent': 'VanlifeClub/1.0 (internal road-trip planner)' } },
    8_000
  )) as Array<{
    code: string;
    nom: string;
    codesPostaux?: string[];
    departement?: { nom?: string };
    region?: { nom?: string };
    population?: number;
    centre?: { coordinates?: [number, number] };
  }>;

  const payload = {
    places: communes
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
      })),
  };
  francePlaceCache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60_000, payload });
  return payload;
}

export async function searchVanSleepSpots(input: {
  query: string;
  radiusKm?: number;
  lat?: number;
  lng?: number;
  label?: string;
}): Promise<VanSleepSearchResult> {
  const query = input.query.trim().slice(0, 100);
  const radiusKm = Math.max(5, Math.min(40, Number(input.radiusKm) || 20));
  const hasSuppliedCoordinates = Number.isFinite(input.lat) && Number.isFinite(input.lng);
  if (query.length < 2) throw new Error('Indique une ville ou un village.');

  const cacheKey = `${query.toLocaleLowerCase('fr')}:${hasSuppliedCoordinates ? `${input.lat!.toFixed(4)},${input.lng!.toFixed(4)}` : 'geo'}:${radiusKm}:v2`;
  const cached = vanSpotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;

  let placeName: string;
  let placeType = 'commune';
  let lat: number;
  let lng: number;

  if (hasSuppliedCoordinates) {
    lat = input.lat!;
    lng = input.lng!;
    placeName = shortPlaceName(input.label || query, query);
    placeType = (input.label || '').toLowerCase().includes('position') ? 'gps' : 'commune';
  } else {
    const geoUrl = new URL('https://geo.api.gouv.fr/communes');
    geoUrl.searchParams.set('nom', query);
    geoUrl.searchParams.set('fields', 'nom,centre,population');
    geoUrl.searchParams.set('boost', 'population');
    geoUrl.searchParams.set('limit', '5');
    const communes = (await fetchJson(
      geoUrl.toString(),
      { headers: { 'User-Agent': 'VanlifeClub/1.0 (internal road-trip planner)' } },
      10_000
    )) as Array<{ nom?: string; population?: number; centre?: { coordinates?: [number, number] } }>;

    const normalized = query.toLocaleLowerCase('fr');
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
    placeName = commune.nom || query;
    lat = commune.centre.coordinates[1];
    lng = commune.centre.coordinates[0];
  }

  const overpass = await queryOverpass(buildVanSpotOverpassQuery(lat, lng, Math.round(radiusKm * 1000)));
  const spots = mapOverpassToSpots(overpass.elements || [], lat, lng);
  const payload: VanSleepSearchResult = {
    query,
    place: { name: placeName, lat, lng, type: placeType },
    radiusKm,
    count: spots.length,
    spots,
    attribution: 'Données © contributeurs OpenStreetMap',
    notice:
      'Priorité aux aires et parkings van recensés. Vérifie toujours panneau et règlement local avant de dormir.',
  };
  vanSpotCache.set(cacheKey, { expiresAt: Date.now() + 30 * 60_000, payload });
  return payload;
}

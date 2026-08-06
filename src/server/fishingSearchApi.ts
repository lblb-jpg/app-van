import {
  buildFishingOverpassQuery,
  mapOverpassToFishingSpots,
} from '../services/fishingSpots';
import type { FishingSpot } from '../types';

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const cache = new Map<string, { expiresAt: number; spots: FishingSpot[] }>();

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
  throw new Error('Les données pêche sont momentanément indisponibles.');
}

export async function searchFishingSpotsAround(lat: number, lng: number, radiusKm = 20) {
  const safeRadius = Math.max(5, Math.min(40, radiusKm));
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)},${safeRadius}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { spots: cached.spots, radiusKm: safeRadius, count: cached.spots.length };
  }

  const overpass = await queryOverpass(
    buildFishingOverpassQuery(lat, lng, Math.round(safeRadius * 1000))
  );
  const spots = mapOverpassToFishingSpots((overpass.elements || []) as any, lat, lng).slice(0, 120);
  cache.set(cacheKey, { expiresAt: Date.now() + 10 * 60_000, spots });

  return {
    spots,
    radiusKm: safeRadius,
    count: spots.length,
    attribution: 'Données © contributeurs OpenStreetMap',
    notice: 'Vérifie la réglementation locale (carte de pêche, réserves) avant de lancer.',
  };
}

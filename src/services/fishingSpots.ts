import type { FishingSpot, FishingSpotKind } from '../types';
import { distanceKm } from './vanSpotEngine';

const OVERPASS_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

export type FishingFilter = 'all' | FishingSpotKind;

type OsmTags = Record<string, string>;

type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
};

export function buildFishingOverpassQuery(lat: number, lng: number, radiusMeters: number) {
  const around = `around:${radiusMeters},${lat},${lng}`;
  // Focused on places useful for fishing — not every waterway segment.
  return `[out:json][timeout:28];
(
  nwr(${around})["leisure"="fishing"];
  nwr(${around})["sport"="fishing"];
  nwr(${around})["fishing"="yes"];
  nwr(${around})["natural"="water"]["water"~"^(lake|pond|reservoir|oxbow|lagoon)$"];
  node(${around})["waterway"="waterfall"];
  nwr(${around})["shop"="fishing"];
  nwr(${around})["shop"="bait"];
  nwr(${around})["shop"="bait_and_tackle"];
);
out center tags;`;
}

function classifyFishing(tags: OsmTags): { kind: FishingSpotKind; label: string } | null {
  if (tags.access === 'private' || tags.access === 'no' || tags.fishing === 'no') return null;

  if (tags.shop === 'fishing' || tags.shop === 'bait' || tags.shop === 'bait_and_tackle') {
    return { kind: 'shop', label: 'Magasin pêche' };
  }
  if (tags.leisure === 'fishing' || tags.sport === 'fishing' || tags.fishing === 'yes') {
    return { kind: 'fishing_spot', label: 'Spot de pêche' };
  }
  if (tags.natural === 'water') {
    const water = (tags.water || '').toLowerCase();
    if (water === 'pond' || water === 'oxbow') return { kind: 'pond', label: 'Étang' };
    if (water === 'reservoir') return { kind: 'lake', label: 'Réservoir' };
    if (water === 'lake' || water === 'lagoon' || !water) return { kind: 'lake', label: 'Lac' };
  }
  if (tags.waterway === 'waterfall') {
    return { kind: 'river', label: 'Cascade / cours d’eau' };
  }
  return null;
}

function elementCoords(el: OsmElement): { lat: number; lng: number } | null {
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) {
    return { lat: el.lat as number, lng: el.lon as number };
  }
  if (el.center && Number.isFinite(el.center.lat) && Number.isFinite(el.center.lon)) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

export function mapOverpassToFishingSpots(
  elements: OsmElement[],
  originLat: number,
  originLng: number
): FishingSpot[] {
  const spots: FishingSpot[] = [];

  for (const el of elements) {
    const tags = el.tags || {};
    const classified = classifyFishing(tags);
    if (!classified) continue;
    const coords = elementCoords(el);
    if (!coords) continue;

    const name =
      tags.name?.trim() ||
      tags['name:fr']?.trim() ||
      classified.label;

    spots.push({
      id: `${el.type}-${el.id}`,
      osmType: el.type,
      osmId: el.id,
      name,
      kind: classified.kind,
      label: classified.label,
      lat: coords.lat,
      lng: coords.lng,
      distanceKm: Math.round(distanceKm(originLat, originLng, coords.lat, coords.lng) * 10) / 10,
      water: tags.water || tags.waterway || undefined,
      access: tags.access || undefined,
      fee: tags.fee || undefined,
      description: tags.description || tags.note || undefined,
      sourceUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`,
    });
  }

  return spots.sort((a, b) => a.distanceKm - b.distanceKm);
}

async function queryOverpass(overpassQuery: string, signal?: AbortSignal) {
  let lastError: unknown;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 28_000);
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          body: new URLSearchParams({ data: overpassQuery }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as { elements?: OsmElement[] };
      } finally {
        window.clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass indisponible');
}

export async function searchFishingSpotsNearby(input: {
  lat: number;
  lng: number;
  radiusKm?: number;
  filter?: FishingFilter;
  signal?: AbortSignal;
}): Promise<FishingSpot[]> {
  const radiusKm = Math.max(5, Math.min(40, input.radiusKm ?? 20));
  const radiusMeters = Math.round(radiusKm * 1000);

  // Prefer app API (avoids CORS / rate limits), then direct Overpass.
  try {
    const params = new URLSearchParams({
      lat: String(input.lat),
      lng: String(input.lng),
      radius: String(radiusKm),
    });
    const response = await fetch(`/api/fishing-spots/search?${params}`, {
      signal: input.signal,
    });
    if (response.ok) {
      const payload = await response.json();
      const spots = Array.isArray(payload.spots) ? (payload.spots as FishingSpot[]) : [];
      return filterFishingSpots(spots, input.filter ?? 'all');
    }
  } catch {
    // fall through
  }

  const overpass = await queryOverpass(
    buildFishingOverpassQuery(input.lat, input.lng, radiusMeters),
    input.signal
  );
  const spots = mapOverpassToFishingSpots(overpass.elements || [], input.lat, input.lng);
  return filterFishingSpots(spots, input.filter ?? 'all');
}

export function filterFishingSpots(spots: FishingSpot[], filter: FishingFilter) {
  if (filter === 'all') return spots;
  return spots.filter((spot) => spot.kind === filter);
}

export function fishingSpotEmoji(kind: FishingSpotKind) {
  if (kind === 'shop') return '🪱';
  if (kind === 'lake') return '🏞️';
  if (kind === 'pond') return '🫧';
  if (kind === 'river') return '🌊';
  return '🎣';
}

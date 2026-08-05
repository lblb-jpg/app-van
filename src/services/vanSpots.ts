import type { FrancePlace, VanSleepSearchResult, VanSleepSpot } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function readApiPayload(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(
      response.ok
        ? 'Réponse API invalide (HTML reçu). Vérifie le déploiement /api.'
        : 'Service de recherche indisponible.'
    );
  }
  const payload = await response.json().catch(() => null);
  if (!isRecord(payload)) throw new Error('Réponse API illisible.');
  return payload;
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

export async function searchVanSleepSpots(
  query: string,
  radiusKm: number,
  place?: Pick<FrancePlace, 'lat' | 'lng' | 'label'>,
  signal?: AbortSignal
): Promise<VanSleepSearchResult> {
  const params = new URLSearchParams({
    q: query.trim(),
    radius: String(radiusKm),
  });
  if (place) {
    params.set('lat', String(place.lat));
    params.set('lng', String(place.lng));
    params.set('label', place.label);
  }
  const response = await fetch(`/api/van-spots/search?${params}`, { signal });
  const payload = await readApiPayload(response);
  if (!response.ok) {
    throw new Error(typeof payload.error === 'string' ? payload.error : 'Impossible de rechercher des spots pour le moment.');
  }
  return normalizeSearchResult(payload, query.trim(), radiusKm);
}

export async function suggestFrenchPlaces(query: string, signal?: AbortSignal): Promise<FrancePlace[]> {
  const response = await fetch(`/api/france-places/suggest?q=${encodeURIComponent(query.trim())}`, { signal });
  const payload = await readApiPayload(response);
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Communes indisponibles.');
  return (Array.isArray(payload.places) ? payload.places : []) as FrancePlace[];
}

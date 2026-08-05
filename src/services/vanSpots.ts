import type { FrancePlace, VanSleepSearchResult } from '../types';

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
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || 'Impossible de rechercher des spots pour le moment.');
  }
  return payload as VanSleepSearchResult;
}

export async function suggestFrenchPlaces(query: string, signal?: AbortSignal): Promise<FrancePlace[]> {
  const response = await fetch(`/api/france-places/suggest?q=${encodeURIComponent(query.trim())}`, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error || 'Communes indisponibles.');
  return (payload?.places || []) as FrancePlace[];
}

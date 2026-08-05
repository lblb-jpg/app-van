import type { VanSleepSpot, Waypoint } from '../types';

/** True when lat/lng are finite and not the default (0, 0) placeholder. */
export function hasValidCoords(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
}

/** Leaflet expects [lat, lng]. */
export function toLeafletCoords(lat: number, lng: number): [number, number] {
  return [lat, lng];
}

export function getSleepSpotEmoji(spot: Pick<VanSleepSpot, 'type'>) {
  if (spot.type === 'camp_site') return '⛺';
  if (spot.type === 'van_parking' || spot.type === 'parking') return '🅿️';
  if (spot.type === 'motorhome_stopover' || spot.type === 'caravan_site') return '🚐';
  return '📍';
}

export function sleepSpotBorderColor(confidence: VanSleepSpot['confidence']) {
  if (confidence === 'official') return '#059669';
  if (confidence === 'likely') return '#ea580c';
  return '#94a3b8';
}

export function getWaypointEmoji(wp: Pick<Waypoint, 'title' | 'vanSpotType' | 'locationName' | 'status'>) {
  const haystack = `${wp.title} ${wp.vanSpotType || ''} ${wp.locationName}`.toLowerCase();
  if (/bivouac|bivou|wild|nature|forêt|forest/.test(haystack)) return '🏕️';
  if (/camping|camp/.test(haystack)) return '⛺';
  if (/aire|parking|park/.test(haystack)) return '🅿️';
  if (/lac|mer|plage|beach|rivière|fleuve/.test(haystack)) return '🏖️';
  if (/mont|col|peak|sommet|alpe/.test(haystack)) return '⛰️';
  if (/ville|city|centre|paris|lille|lyon/.test(haystack)) return '🏙️';
  if (/resto|food|manger|café|restaurant/.test(haystack)) return '🍽️';
  if (wp.status === 'done') return '✅';
  if (wp.status === 'active') return '🚐';
  return '📍';
}

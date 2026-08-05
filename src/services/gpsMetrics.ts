import { GpsPoint } from '../types';
import { calculateHaversineDistance } from './gpx';

/** Ignore GPS jitter under this distance when accumulating track distance. */
export const MIN_MOVE_METERS = 6;
/** Reject fixes worse than this accuracy (meters). */
export const MAX_ACCURACY_METERS = 55;
/** Reject physically impossible jumps (m/s ≈ 216 km/h). */
export const MAX_REALISTIC_SPEED_MS = 60;

export function trackDistanceKm(points: GpsPoint[]): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    total += calculateHaversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
  }
  return total;
}

export function maxSpeedKmH(points: GpsPoint[]): number {
  let max = 0;
  for (const p of points) {
    if (p.speed != null && Number.isFinite(p.speed) && p.speed > max) max = p.speed;
  }
  return max;
}

export function avgMovingSpeedKmH(points: GpsPoint[], distanceKm: number): number {
  if (points.length < 2 || distanceKm <= 0) return 0;
  let movingMs = 0;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].timestamp - points[i - 1].timestamp;
    const segmentKm = calculateHaversineDistance(
      points[i - 1].lat,
      points[i - 1].lng,
      points[i].lat,
      points[i].lng
    );
    // Count time only when the van actually moved.
    if (dt > 0 && dt < 120_000 && segmentKm * 1000 >= MIN_MOVE_METERS) {
      movingMs += dt;
    }
  }
  if (movingMs <= 0) return 0;
  const hours = movingMs / 3_600_000;
  return distanceKm / hours;
}

export function speedFromCoords(
  coords: GeolocationCoordinates,
  previous: GpsPoint | null,
  now: number
): number {
  const device = coords.speed;
  if (device != null && Number.isFinite(device) && device >= 0) {
    return Math.max(0, device * 3.6);
  }

  if (!previous) return 0;
  const dtSec = (now - previous.timestamp) / 1000;
  if (dtSec < 0.8 || dtSec > 45) return 0;

  const distKm = calculateHaversineDistance(
    previous.lat,
    previous.lng,
    coords.latitude,
    coords.longitude
  );
  const distM = distKm * 1000;
  if (distM < 2) return 0;

  const speedMs = distM / dtSec;
  if (speedMs > MAX_REALISTIC_SPEED_MS) return 0;
  return Math.max(0, speedMs * 3.6);
}

export function shouldAcceptTrackPoint(
  candidate: GpsPoint,
  lastAccepted: GpsPoint | null,
  accuracyMeters: number | null | undefined
): { accept: boolean; reason?: string } {
  if (
    accuracyMeters != null &&
    Number.isFinite(accuracyMeters) &&
    accuracyMeters > MAX_ACCURACY_METERS
  ) {
    return { accept: false, reason: 'accuracy' };
  }

  if (!lastAccepted) return { accept: true };

  const dtSec = (candidate.timestamp - lastAccepted.timestamp) / 1000;
  if (dtSec < 0.4) return { accept: false, reason: 'too-fast' };

  const distKm = calculateHaversineDistance(
    lastAccepted.lat,
    lastAccepted.lng,
    candidate.lat,
    candidate.lng
  );
  const distM = distKm * 1000;

  if (dtSec > 0 && distM / dtSec > MAX_REALISTIC_SPEED_MS) {
    return { accept: false, reason: 'teleport' };
  }

  // Always keep a heartbeat point every ~12s even if nearly still (for GPX continuity).
  if (distM < MIN_MOVE_METERS && dtSec < 12) {
    return { accept: false, reason: 'jitter' };
  }

  return { accept: true };
}

export function smoothSpeedKmH(previousDisplay: number, rawKmH: number, alpha = 0.4): number {
  if (!Number.isFinite(rawKmH)) return previousDisplay;
  if (!Number.isFinite(previousDisplay)) return rawKmH;
  return previousDisplay * (1 - alpha) + rawKmH * alpha;
}

export function formatDistanceKm(km: number): { value: string; unit: string } {
  if (!Number.isFinite(km) || km <= 0) return { value: '0.0', unit: 'km' };
  if (km < 1) {
    return { value: String(Math.round(km * 1000)), unit: 'm' };
  }
  if (km < 10) return { value: km.toFixed(2), unit: 'km' };
  return { value: km.toFixed(1), unit: 'km' };
}

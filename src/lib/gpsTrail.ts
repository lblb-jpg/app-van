import type { GpsPoint, GpsTrack } from '../types';
import { calculateHaversineDistance } from '../services/gpx';

/** Minimum displacement (m) before appending a breadcrumb. */
export const TRAIL_MIN_MOVE_M = 12;

/** Ignore fixes worse than this accuracy (m). */
export const TRAIL_MAX_ACCURACY_M = 55;

/** Persist local trail at most this often. */
export const TRAIL_PERSIST_MS = 8_000;

/** Push new points to Supabase at most this often. */
export const TRAIL_CLOUD_SYNC_MS = 25_000;

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function recomputeTrackStats(points: GpsPoint[]): Pick<
  GpsTrack,
  'distanceKm' | 'avgSpeedKmH' | 'maxSpeedKmH'
> {
  let distanceKm = 0;
  let maxSpeedKmH = 0;
  let speedSum = 0;
  let speedCount = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.speed != null && Number.isFinite(p.speed) && p.speed > 0) {
      maxSpeedKmH = Math.max(maxSpeedKmH, p.speed);
      speedSum += p.speed;
      speedCount += 1;
    }
    if (i === 0) continue;
    const prev = points[i - 1];
    distanceKm += calculateHaversineDistance(prev.lat, prev.lng, p.lat, p.lng);
  }

  const durationH =
    points.length >= 2
      ? Math.max((points[points.length - 1].timestamp - points[0].timestamp) / 3_600_000, 0)
      : 0;
  const avgFromDistance = durationH > 0.02 ? distanceKm / durationH : 0;
  const avgSpeedKmH = speedCount > 0 ? speedSum / speedCount : avgFromDistance;

  return {
    distanceKm: Math.round(distanceKm * 100) / 100,
    avgSpeedKmH: Math.round(avgSpeedKmH * 10) / 10,
    maxSpeedKmH: Math.round(maxSpeedKmH * 10) / 10,
  };
}

export function createActiveTrack(friendId: string, point: GpsPoint): GpsTrack {
  const date = dayKey(point.timestamp);
  return {
    id: crypto.randomUUID(),
    title: `Trace ${date}`,
    date,
    startTime: point.timestamp,
    distanceKm: 0,
    avgSpeedKmH: 0,
    maxSpeedKmH: point.speed && point.speed > 0 ? point.speed : 0,
    points: [point],
    isActive: true,
    createdByFriendId: friendId,
  };
}

export function closeTrack(track: GpsTrack, endTime = Date.now()): GpsTrack {
  const stats = recomputeTrackStats(track.points);
  return {
    ...track,
    ...stats,
    endTime,
    isActive: false,
  };
}

/**
 * Append a GPS fix to the active day trail (starts/rolls a new day track when needed).
 * Returns null if the fix should be ignored (too close / bad accuracy).
 */
export function appendTrailPoint(
  tracks: GpsTrack[],
  point: GpsPoint,
  friendId: string,
  options?: { accuracyM?: number }
): GpsTrack[] | null {
  if (
    options?.accuracyM != null &&
    Number.isFinite(options.accuracyM) &&
    options.accuracyM > TRAIL_MAX_ACCURACY_M
  ) {
    return null;
  }

  const activeIdx = tracks.findIndex((t) => t.isActive);
  let working = tracks;

  if (activeIdx >= 0) {
    const active = tracks[activeIdx];
    const last = active.points[active.points.length - 1];
    if (last && dayKey(last.timestamp) !== dayKey(point.timestamp)) {
      const closed = closeTrack(active, last.timestamp);
      working = tracks.map((t, i) => (i === activeIdx ? closed : t));
    }
  }

  const currentIdx = working.findIndex((t) => t.isActive);
  if (currentIdx < 0) {
    return [createActiveTrack(friendId, point), ...working];
  }

  const active = working[currentIdx];
  const last = active.points[active.points.length - 1];
  if (last) {
    const movedM = calculateHaversineDistance(last.lat, last.lng, point.lat, point.lng) * 1000;
    if (movedM < TRAIL_MIN_MOVE_M) return null;
    if (point.timestamp < last.timestamp) return null;
  }

  const points = [...active.points, point];
  const stats = recomputeTrackStats(points);
  const updated: GpsTrack = {
    ...active,
    ...stats,
    points,
    endTime: undefined,
    isActive: true,
  };

  return working.map((t, i) => (i === currentIdx ? updated : t));
}

/** Merge cloud tracks with local ones, preserving richer local points and the active trail. */
export function mergeIncomingTracks(incoming: GpsTrack[], previous: GpsTrack[]): GpsTrack[] {
  const prevById = new Map(previous.map((t) => [t.id, t]));
  const incomingIds = new Set(incoming.map((t) => t.id));

  const merged: GpsTrack[] = incoming.map((remote) => {
    const local = prevById.get(remote.id);
    if (!local) return { ...remote, isActive: false };

    const remotePoints = remote.points ?? [];
    const localPoints = local.points ?? [];
    const points =
      remotePoints.length >= localPoints.length
        ? remotePoints
        : localPoints.length > 0
          ? localPoints
          : remotePoints;

    const stats = points.length ? recomputeTrackStats(points) : remote;
    return {
      ...remote,
      ...stats,
      points,
      isActive: Boolean(local.isActive) && !remote.endTime,
    };
  });

  for (const local of previous) {
    if (!incomingIds.has(local.id) && (local.isActive || (local.points?.length ?? 0) > 0)) {
      merged.unshift(local);
    }
  }

  // At most one active track.
  let sawActive = false;
  return merged.map((t) => {
    if (!t.isActive) return t;
    if (sawActive) return { ...t, isActive: false };
    sawActive = true;
    return t;
  });
}

export function getActiveTrack(tracks: GpsTrack[]): GpsTrack | undefined {
  return tracks.find((t) => t.isActive);
}

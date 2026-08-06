import type { Expense, Friend, JournalNote, Poi, TripPhoto, GpsTrack } from '../types';
import {
  CREW_MEMBER_NAMES,
  getStoredCrewUserMap,
  type CrewMemberName,
  type CrewUserMap,
} from '../services/supabase';

const LEGACY_SLUGS = ['adel', 'paul', 'yanis'] as const;

function isUuid(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id
  );
}

/** Build adel/paul/yanis → UUID map from crew storage + current friends. */
export function buildLegacyIdMap(
  friends: Friend[],
  crewMap: CrewUserMap = getStoredCrewUserMap()
): Map<string, string> {
  const map = new Map<string, string>();

  for (const name of CREW_MEMBER_NAMES) {
    const uuid = crewMap[name];
    if (uuid) {
      map.set(name.toLowerCase(), uuid);
      map.set(name, uuid);
    }
  }

  for (const friend of friends) {
    if (!isUuid(friend.id)) continue;
    const slug = friend.name.trim().toLowerCase();
    if (LEGACY_SLUGS.includes(slug as (typeof LEGACY_SLUGS)[number])) {
      map.set(slug, friend.id);
    }
  }

  return map;
}

export function remapFriendId(
  rawId: string | undefined,
  legacyMap: Map<string, string>,
  validIds?: Set<string>
): string | undefined {
  if (!rawId) return undefined;
  if (validIds?.has(rawId)) return rawId;
  if (isUuid(rawId)) return rawId;
  const mapped = legacyMap.get(rawId) ?? legacyMap.get(rawId.toLowerCase());
  if (mapped && (!validIds || validIds.has(mapped))) return mapped;
  return rawId;
}

export function normalizeBundleFriendIds<T extends {
  expenses: Expense[];
  journal: JournalNote[];
  photos: TripPhoto[];
  pois: Poi[];
  tracks: GpsTrack[];
}>(bundle: T, friends: Friend[], crewMap?: CrewUserMap): T {
  const legacyMap = buildLegacyIdMap(friends, crewMap);
  const validIds = new Set(friends.map((friend) => friend.id));
  const remap = (id: string | undefined) => remapFriendId(id, legacyMap, validIds) ?? id ?? '';

  return {
    ...bundle,
    expenses: bundle.expenses.map((expense) => ({
      ...expense,
      paidByFriendId: remap(expense.paidByFriendId),
      splitAmongFriendIds: expense.splitAmongFriendIds.map((id) => remap(id)),
      splitDetails: expense.splitDetails?.map((detail) => ({
        ...detail,
        friendId: remap(detail.friendId),
      })),
    })),
    journal: bundle.journal.map((note) => ({
      ...note,
      friendId: remap(note.friendId),
    })),
    photos: bundle.photos.map((photo) => ({
      ...photo,
      friendId: remap(photo.friendId),
    })),
    pois: bundle.pois.map((poi) => ({
      ...poi,
      createdByFriendId: remap(poi.createdByFriendId),
    })),
    tracks: bundle.tracks.map((track) => ({
      ...track,
      createdByFriendId: remap(track.createdByFriendId),
    })),
  };
}

export function crewSlugToMemberName(slug: string): CrewMemberName | undefined {
  return CREW_MEMBER_NAMES.find((name) => name.toLowerCase() === slug.toLowerCase());
}

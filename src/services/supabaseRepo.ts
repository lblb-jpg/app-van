import type { User, SupabaseClient } from '@supabase/supabase-js';
import type {
  Expense,
  ExpenseCategory,
  Friend,
  GpsPoint,
  GpsTrack,
  JournalNote,
  Poi,
  PoiType,
  SplitType,
  TripPhoto,
  Waypoint,
} from '../types';
import { ensureSupabaseSession, getSupabaseClient } from './supabase';

const TRIP_KEY = 'van_current_trip_id_v1';
const POINT_CHUNK = 400;

export type CloudContext = {
  supabase: SupabaseClient;
  user: User;
  tripId: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function makeInitialAvatar(name: string, background: string) {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${background}"/><text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="white">${name.slice(0, 1).toUpperCase()}</text></svg>`
  )}`;
}

function toIsoDate(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  return value.slice(0, 10);
}

export function formatLastActive(updatedAt?: string | number | null) {
  if (updatedAt == null || updatedAt === '') return undefined;
  const ms = typeof updatedAt === 'number' ? updatedAt : new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return undefined;
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSec < 20) return 'À l’instant';
  if (deltaSec < 60) return `Il y a ${deltaSec}s`;
  if (deltaSec < 3600) return `Il y a ${Math.floor(deltaSec / 60)} min`;
  if (deltaSec < 86400) return `Il y a ${Math.floor(deltaSec / 3600)} h`;
  return new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function extractTripPhotoStoragePath(value: string): string | null {
  if (!value) return null;
  if (value.startsWith('data:') || value.startsWith('blob:')) return null;

  const markers = [
    '/storage/v1/object/public/trip-photos/',
    '/storage/v1/object/sign/trip-photos/',
    '/storage/v1/object/authenticated/trip-photos/',
  ];
  for (const marker of markers) {
    const idx = value.indexOf(marker);
    if (idx >= 0) {
      const rest = value.slice(idx + marker.length);
      return decodeURIComponent(rest.split('?')[0] || '');
    }
  }

  if (value.startsWith('http://') || value.startsWith('https://')) return null;
  return value;
}

async function resolvePhotoUrl(storagePath: string, supabase: SupabaseClient) {
  if (!storagePath) return '';
  if (storagePath.startsWith('data:') || storagePath.startsWith('blob:')) {
    return storagePath;
  }

  const path = extractTripPhotoStoragePath(storagePath);
  if (!path) return storagePath; // External URL (Unsplash, etc.)

  // Private bucket: signed URL required for <img src>.
  const { data: signed, error } = await supabase.storage
    .from('trip-photos')
    .createSignedUrl(path, 60 * 60 * 24);
  if (!error && signed?.signedUrl) return signed.signedUrl;

  const { data } = supabase.storage.from('trip-photos').getPublicUrl(path);
  return data.publicUrl;
}

async function uploadPhotoBlob(
  supabase: SupabaseClient,
  tripId: string,
  userId: string,
  source: string,
  filenameHint = 'photo.jpg'
) {
  if (!source) return '';

  // Already a storage path or known trip-photos URL → keep path.
  const existingPath = extractTripPhotoStoragePath(source);
  if (existingPath && !source.startsWith('data:')) {
    return existingPath;
  }

  // External https (Unsplash, etc.) — store as-is (not in bucket).
  if (
    (source.startsWith('http://') || source.startsWith('https://')) &&
    !extractTripPhotoStoragePath(source)
  ) {
    return source;
  }

  let blob: Blob;
  let ext = 'jpg';
  if (source.startsWith('data:') || source.startsWith('blob:')) {
    const res = await fetch(source);
    blob = await res.blob();
    const mime = blob.type || 'image/jpeg';
    ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
  } else {
    blob = new Blob([source], { type: 'text/plain' });
  }

  const path = `${tripId}/${userId}/${Date.now()}-${filenameHint.replace(/\s+/g, '-')}.${ext}`;
  const { error } = await supabase.storage.from('trip-photos').upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;
  return path;
}

function isLocalOnlyId(id: string | undefined) {
  if (!id) return true;
  if (isUuid(id)) return false;
  return true;
}

function poiFingerprint(poi: Pick<Poi, 'title' | 'lat' | 'lng'>) {
  return `${poi.title.trim().toLowerCase()}|${poi.lat.toFixed(5)}|${poi.lng.toFixed(5)}`;
}

function waypointFingerprint(wp: Pick<Waypoint, 'title' | 'lat' | 'lng'>) {
  return `${wp.title.trim().toLowerCase()}|${wp.lat.toFixed(5)}|${wp.lng.toFixed(5)}`;
}

function journalFingerprint(note: Pick<JournalNote, 'title' | 'date' | 'content'>) {
  return `${note.title.trim().toLowerCase()}|${toIsoDate(note.date)}|${note.content.trim().slice(0, 80)}`;
}

function photoFingerprint(photo: Pick<TripPhoto, 'caption' | 'date' | 'url'>) {
  const urlKey = photo.url.startsWith('data:') ? `data:${photo.url.length}` : photo.url.slice(0, 120);
  return `${(photo.caption || '').trim().toLowerCase()}|${toIsoDate(photo.date)}|${urlKey}`;
}

function expenseFingerprint(expense: Pick<Expense, 'description' | 'amount' | 'date'>) {
  return `${expense.description.trim().toLowerCase()}|${Number(expense.amount).toFixed(2)}|${toIsoDate(expense.date)}`;
}

function mapExpenseRow(row: any): Expense {
  const splits = (row.expense_splits ?? []) as Array<{
    user_id: string;
    share_count?: number | string | null;
    split_amount?: number | string | null;
  }>;
  const splitAmongFriendIds = splits.map((split) => split.user_id);
  const splitType = (row.split_type as SplitType | null) ?? 'equal';
  const splitDetails = splits.map((split) => ({
    friendId: split.user_id,
    shares: split.share_count != null ? Number(split.share_count) : undefined,
    amount: split.split_amount != null ? Number(split.split_amount) : undefined,
  }));

  return {
    id: row.id,
    description: row.description?.trim() || 'Dépense',
    amount: Number(row.amount),
    category: row.category as ExpenseCategory,
    date: toIsoDate(row.spent_on),
    paidByFriendId: row.paid_by,
    splitAmongFriendIds,
    splitType,
    splitDetails: splitDetails.length ? splitDetails : undefined,
    currency: row.currency ?? 'EUR',
    notes: row.notes ?? undefined,
  };
}

function buildSplitRows(
  expense: Omit<Expense, 'id'>,
  memberIds: Set<string>,
  paidBy: string,
  currentUserId: string
) {
  const participants = (expense.splitAmongFriendIds?.length ? expense.splitAmongFriendIds : [paidBy])
    .map((id) => asMemberId(id, currentUserId, memberIds))
    .filter((id, idx, arr) => arr.indexOf(id) === idx);

  const splitType = expense.splitType ?? 'equal';
  const details = expense.splitDetails ?? [];

  return participants.map((user_id) => {
    const detail = details.find(
      (item) => asMemberId(item.friendId, currentUserId, memberIds) === user_id
    );
    return {
      user_id,
      share_count: splitType === 'shares' ? (detail?.shares ?? 1) : 1,
      split_amount: splitType === 'custom' && detail?.amount != null ? detail.amount : null,
    };
  });
}

function trackFingerprint(track: Pick<GpsTrack, 'title' | 'date' | 'distanceKm'>) {
  return `${track.title.trim().toLowerCase()}|${toIsoDate(track.date)}|${Number(track.distanceKm).toFixed(2)}`;
}

export async function bootstrapCloud(): Promise<CloudContext | null> {
  const { supabase, user, error } = await ensureSupabaseSession();
  if (!supabase || !user) {
    if (error) console.warn('Supabase session:', error.message);
    return null;
  }

  // Ensure profile row exists (trigger usually creates it; upsert as safety net).
  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle();
  if (!profile) {
    const name =
      (user.user_metadata?.name as string | undefined) ||
      user.email?.split('@')[0] ||
      'Voyageur';
    const { error: profileError } = await supabase.from('profiles').insert({
      id: user.id,
      name,
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
      color: '#059669',
    });
    if (profileError) throw profileError;
  }

  let tripId = localStorage.getItem(TRIP_KEY);
  if (tripId) {
    const { data: existing } = await supabase.from('trips').select('id').eq('id', tripId).maybeSingle();
    if (!existing) {
      tripId = null;
    } else {
      const { data: membership } = await supabase
        .from('trip_members')
        .select('trip_id')
        .eq('trip_id', tripId)
        .eq('user_id', user.id)
        .maybeSingle();
      if (!membership) tripId = null;
    }
  }

  if (!tripId) {
    const { data: memberships, error: memberError } = await supabase
      .from('trip_members')
      .select('trip_id, joined_at')
      .eq('user_id', user.id)
      .order('joined_at', { ascending: true })
      .limit(1);
    if (memberError) throw memberError;
    tripId = memberships?.[0]?.trip_id ?? null;
  }

  if (!tripId) {
    const { data: created, error: tripError } = await supabase
      .from('trips')
      .insert({
        name: 'Mon Road Trip Van',
        description: 'Voyage synchronisé depuis VanLife GPS',
        owner_id: user.id,
      })
      .select('id')
      .single();
    if (tripError) throw tripError;
    tripId = created.id;
  }

  // Safety: guarantee membership row (owner trigger usually handles create).
  const { data: ensuredMember } = await supabase
    .from('trip_members')
    .select('trip_id')
    .eq('trip_id', tripId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!ensuredMember) {
    const { error: memberInsertError } = await supabase.from('trip_members').insert({
      trip_id: tripId,
      user_id: user.id,
      member_role: 'owner',
    });
    if (memberInsertError) {
      console.warn('trip_members ensure failed:', memberInsertError.message);
    }
  }

  localStorage.setItem(TRIP_KEY, tripId);
  return { supabase, user, tripId };
}

function upperInviteCode(seed: string) {
  return seed.replace(/-/g, '').slice(0, 8).toUpperCase();
}

export async function getTripInviteCode(ctx: CloudContext) {
  try {
    const { data, error } = await ctx.supabase
      .from('trips')
      .select('invite_code')
      .eq('id', ctx.tripId)
      .maybeSingle();
    if (!error && data?.invite_code) return String(data.invite_code).toUpperCase();
  } catch {
    // Column may not exist yet — fall back to trip id prefix.
  }
  return upperInviteCode(ctx.tripId);
}

export async function joinTripByCode(ctx: CloudContext, inviteCode: string) {
  const cleaned = inviteCode.trim().toUpperCase();
  const { data, error } = await ctx.supabase.rpc('join_trip_by_code', { invite: cleaned });
  if (error) throw error;
  const tripId = String(data);
  localStorage.setItem(TRIP_KEY, tripId);
  return tripId;
}

export function setActiveTripId(tripId: string) {
  localStorage.setItem(TRIP_KEY, tripId);
}

export async function loadTripBundle(ctx: CloudContext) {
  const { supabase, user, tripId } = ctx;

  const [
    membersRes,
    locationsRes,
    poisRes,
    waypointsRes,
    journalRes,
    photosRes,
    expensesRes,
    tracksRes,
  ] = await Promise.all([
    supabase
      .from('trip_members')
      .select('user_id, member_role, profiles(id, name, avatar_url, color, role_label)')
      .eq('trip_id', tripId),
    supabase.from('member_locations').select('*').eq('trip_id', tripId),
    supabase.from('pois').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }),
    supabase.from('waypoints').select('*').eq('trip_id', tripId).order('position', { ascending: true }),
    supabase.from('journal_notes').select('*').eq('trip_id', tripId).order('happened_on', { ascending: false }),
    supabase.from('photos').select('*').eq('trip_id', tripId).order('taken_on', { ascending: false }),
    supabase
      .from('expenses')
      .select('*, expense_splits(user_id, share_count, split_amount)')
      .eq('trip_id', tripId)
      .order('spent_on', { ascending: false }),
    supabase.from('gps_tracks').select('*').eq('trip_id', tripId).order('tracked_on', { ascending: false }),
  ]);

  for (const res of [membersRes, locationsRes, poisRes, waypointsRes, journalRes, photosRes, expensesRes, tracksRes]) {
    if (res.error) throw res.error;
  }

  const locationsByUser = new Map(
    (locationsRes.data ?? []).map((row) => [
      row.user_id as string,
      row as { lat: number; lng: number; battery: number | null; updated_at: string },
    ])
  );

  const friends: Friend[] = (membersRes.data ?? []).map((row: any) => {
    const profile = row.profiles;
    const loc = locationsByUser.get(row.user_id);
    const name = profile?.name || 'Voyageur';
    const color = profile?.color || '#059669';
    const lastActiveAt = loc?.updated_at ? new Date(loc.updated_at).getTime() : undefined;
    return {
      id: row.user_id as string,
      name,
      avatar: profile?.avatar_url || makeInitialAvatar(name, color),
      color,
      role: profile?.role_label || (row.member_role === 'owner' ? 'Capitaine' : 'Équipier'),
      isCurrentUser: row.user_id === user.id,
      liveLat: loc?.lat,
      liveLng: loc?.lng,
      battery: loc?.battery ?? undefined,
      lastActiveAt,
      lastActive: formatLastActive(lastActiveAt),
    };
  });

  if (!friends.some((f) => f.id === user.id)) {
    friends.unshift({
      id: user.id,
      name: (user.user_metadata?.name as string) || user.email?.split('@')[0] || 'Moi',
      avatar: makeInitialAvatar('Moi', '#059669'),
      color: '#059669',
      role: 'Capitaine',
      isCurrentUser: true,
    });
  }

  const photos: TripPhoto[] = await Promise.all(
    (photosRes.data ?? [])
      .filter((row) => !row.journal_note_id)
      .map(async (row) => ({
        id: row.id,
        url: await resolvePhotoUrl(row.storage_path, supabase),
        caption: row.caption ?? undefined,
        date: toIsoDate(row.taken_on),
        friendId: row.author_id,
        lat: row.lat ?? undefined,
        lng: row.lng ?? undefined,
        locationName: row.location_name ?? undefined,
      }))
  );

  const photosByNote = new Map<string, string[]>();
  for (const row of photosRes.data ?? []) {
    if (!row.journal_note_id) continue;
    const list = photosByNote.get(row.journal_note_id) ?? [];
    list.push(await resolvePhotoUrl(row.storage_path, supabase));
    photosByNote.set(row.journal_note_id, list);
  }

  const journal: JournalNote[] = (journalRes.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    date: toIsoDate(row.happened_on),
    friendId: row.author_id,
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    locationName: row.location_name ?? undefined,
    photos: photosByNote.get(row.id) ?? [],
  }));

  const pois: Poi[] = (poisRes.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    type: row.type as PoiType,
    lat: row.lat,
    lng: row.lng,
    createdAt: row.created_at,
    createdByFriendId: row.created_by,
    photoUrl: row.photo_url ?? undefined,
    amenities: row.amenities ?? [],
  }));

  const waypoints: Waypoint[] = await Promise.all(
    (waypointsRes.data ?? []).map((row) => mapWaypoint(row, supabase))
  );

  const expenses: Expense[] = (expensesRes.data ?? []).map(mapExpenseRow);

  const trackIds = (tracksRes.data ?? []).map((t) => t.id);
  let pointsByTrack = new Map<string, GpsPoint[]>();
  if (trackIds.length) {
    const { data: points, error: pointsError } = await supabase
      .from('gps_track_points')
      .select('*')
      .in('track_id', trackIds)
      .order('recorded_at', { ascending: true });
    if (pointsError) throw pointsError;
    pointsByTrack = (points ?? []).reduce((acc, row) => {
      const list = acc.get(row.track_id) ?? [];
      list.push({
        lat: row.lat,
        lng: row.lng,
        altitude: row.altitude_m ?? undefined,
        speed: row.speed_kmh ?? undefined,
        timestamp: new Date(row.recorded_at).getTime(),
      });
      acc.set(row.track_id, list);
      return acc;
    }, new Map<string, GpsPoint[]>());
  }

  const tracks: GpsTrack[] = (tracksRes.data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    date: toIsoDate(row.tracked_on),
    startTime: new Date(row.started_at).getTime(),
    endTime: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
    distanceKm: Number(row.distance_km),
    avgSpeedKmH: Number(row.avg_speed_kmh),
    maxSpeedKmH: Number(row.max_speed_kmh),
    createdByFriendId: row.created_by,
    points: pointsByTrack.get(row.id) ?? [],
  }));

  return { friends, pois, waypoints, journal, photos, expenses, tracks };
}

function asMemberId(friendId: string | undefined, fallbackUserId: string, memberIds: Set<string>) {
  if (friendId && isUuid(friendId) && memberIds.has(friendId)) return friendId;
  return fallbackUserId;
}

export async function insertPoi(ctx: CloudContext, poi: Omit<Poi, 'id' | 'createdAt'> & { id?: string }) {
  const memberIds = new Set((await loadMemberIds(ctx)));
  const createdBy = asMemberId(poi.createdByFriendId, ctx.user.id, memberIds);
  let photoUrl = poi.photoUrl ?? null;
  if (photoUrl && (photoUrl.startsWith('data:') || photoUrl.startsWith('blob:'))) {
    const path = await uploadPhotoBlob(ctx.supabase, ctx.tripId, ctx.user.id, photoUrl, 'poi.jpg');
    photoUrl = await resolvePhotoUrl(path, ctx.supabase);
  }
  const { data, error } = await ctx.supabase
    .from('pois')
    .insert({
      trip_id: ctx.tripId,
      title: poi.title,
      description: poi.description ?? null,
      type: poi.type,
      lat: poi.lat,
      lng: poi.lng,
      photo_url: photoUrl,
      amenities: poi.amenities ?? [],
      created_by: createdBy,
    })
    .select('*')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    title: data.title,
    description: data.description ?? undefined,
    type: data.type as PoiType,
    lat: data.lat,
    lng: data.lng,
    createdAt: data.created_at,
    createdByFriendId: data.created_by,
    photoUrl: data.photo_url ?? undefined,
    amenities: data.amenities ?? [],
  } satisfies Poi;
}

export async function deletePoi(ctx: CloudContext, id: string) {
  const { error } = await ctx.supabase.from('pois').delete().eq('id', id).eq('trip_id', ctx.tripId);
  if (error) throw error;
}

export async function deleteJournalNote(ctx: CloudContext, id: string) {
  // Linked gallery rows cascade via journal_note_id FK if configured; otherwise clear manually.
  await ctx.supabase.from('photos').delete().eq('journal_note_id', id).eq('trip_id', ctx.tripId);
  const { error } = await ctx.supabase.from('journal_notes').delete().eq('id', id).eq('trip_id', ctx.tripId);
  if (error) throw error;
}

export async function deletePhoto(ctx: CloudContext, id: string) {
  const { data } = await ctx.supabase
    .from('photos')
    .select('storage_path')
    .eq('id', id)
    .eq('trip_id', ctx.tripId)
    .maybeSingle();
  const { error } = await ctx.supabase.from('photos').delete().eq('id', id).eq('trip_id', ctx.tripId);
  if (error) throw error;
  const path = data?.storage_path ? extractTripPhotoStoragePath(data.storage_path) : null;
  if (path) {
    await ctx.supabase.storage.from('trip-photos').remove([path]).catch(() => undefined);
  }
}

export async function insertJournalNote(ctx: CloudContext, note: Omit<JournalNote, 'id'> & { id?: string }) {
  const memberIds = new Set(await loadMemberIds(ctx));
  const authorId = asMemberId(note.friendId, ctx.user.id, memberIds);
  const { data, error } = await ctx.supabase
    .from('journal_notes')
    .insert({
      trip_id: ctx.tripId,
      author_id: authorId,
      title: note.title,
      content: note.content,
      happened_on: toIsoDate(note.date),
      lat: note.lat ?? null,
      lng: note.lng ?? null,
      location_name: note.locationName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;

  const photoUrls: string[] = [];
  for (const source of note.photos ?? []) {
    const storagePath = await uploadPhotoBlob(ctx.supabase, ctx.tripId, ctx.user.id, source);
    const { error: photoError } = await ctx.supabase.from('photos').insert({
      trip_id: ctx.tripId,
      author_id: authorId,
      journal_note_id: data.id,
      storage_path: storagePath,
      taken_on: toIsoDate(note.date),
      lat: note.lat ?? null,
      lng: note.lng ?? null,
      location_name: note.locationName ?? null,
    });
    if (photoError) throw photoError;
    photoUrls.push(await resolvePhotoUrl(storagePath, ctx.supabase));
  }

  return {
    id: data.id,
    title: data.title,
    content: data.content,
    date: toIsoDate(data.happened_on),
    friendId: data.author_id,
    lat: data.lat ?? undefined,
    lng: data.lng ?? undefined,
    locationName: data.location_name ?? undefined,
    photos: photoUrls,
  } satisfies JournalNote;
}

export async function insertPhoto(ctx: CloudContext, photo: Omit<TripPhoto, 'id'> & { id?: string }) {
  const memberIds = new Set(await loadMemberIds(ctx));
  const authorId = asMemberId(photo.friendId, ctx.user.id, memberIds);
  const storagePath = await uploadPhotoBlob(ctx.supabase, ctx.tripId, ctx.user.id, photo.url);
  const { data, error } = await ctx.supabase
    .from('photos')
    .insert({
      trip_id: ctx.tripId,
      author_id: authorId,
      storage_path: storagePath,
      caption: photo.caption ?? null,
      taken_on: toIsoDate(photo.date),
      lat: photo.lat ?? null,
      lng: photo.lng ?? null,
      location_name: photo.locationName ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    url: await resolvePhotoUrl(data.storage_path, ctx.supabase),
    caption: data.caption ?? undefined,
    date: toIsoDate(data.taken_on),
    friendId: data.author_id,
    lat: data.lat ?? undefined,
    lng: data.lng ?? undefined,
    locationName: data.location_name ?? undefined,
  } satisfies TripPhoto;
}

export async function insertExpense(ctx: CloudContext, expense: Omit<Expense, 'id'> & { id?: string }) {
  const memberIds = new Set(await loadMemberIds(ctx));
  const paidBy = asMemberId(expense.paidByFriendId, ctx.user.id, memberIds);
  const splitRows = buildSplitRows(expense, memberIds, paidBy, ctx.user.id);

  const baseRow = {
    trip_id: ctx.tripId,
    description: expense.description,
    amount: expense.amount,
    category: expense.category,
    spent_on: toIsoDate(expense.date),
    paid_by: paidBy,
    created_by: ctx.user.id,
    split_type: expense.splitType ?? 'equal',
    currency: expense.currency ?? 'EUR',
    notes: expense.notes ?? null,
  };

  let { data, error } = await ctx.supabase.from('expenses').insert(baseRow).select('*').single();

  if (error && /split_type|currency|notes/i.test(error.message || '')) {
    ({ data, error } = await ctx.supabase
      .from('expenses')
      .insert({
        trip_id: ctx.tripId,
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        spent_on: toIsoDate(expense.date),
        paid_by: paidBy,
        created_by: ctx.user.id,
      })
      .select('*')
      .single());
  }
  if (error) throw error;

  if (splitRows.length) {
    const splitPayload = splitRows.map((row) => ({ expense_id: data.id, ...row }));
    let { error: splitError } = await ctx.supabase.from('expense_splits').insert(splitPayload);
    if (splitError && /share_count|split_amount/i.test(splitError.message || '')) {
      ({ error: splitError } = await ctx.supabase.from('expense_splits').insert(
        splitRows.map((row) => ({ expense_id: data.id, user_id: row.user_id }))
      ));
    }
    if (splitError) throw splitError;
  }

  return mapExpenseRow({
    ...data,
    expense_splits: splitRows.map((row) => ({
      user_id: row.user_id,
      share_count: row.share_count,
      split_amount: row.split_amount,
    })),
    split_type: expense.splitType ?? 'equal',
    currency: expense.currency ?? 'EUR',
    notes: expense.notes ?? null,
  });
}

export async function updateExpense(ctx: CloudContext, id: string, expense: Omit<Expense, 'id'>) {
  const memberIds = new Set(await loadMemberIds(ctx));
  const paidBy = asMemberId(expense.paidByFriendId, ctx.user.id, memberIds);
  const splitRows = buildSplitRows(expense, memberIds, paidBy, ctx.user.id);

  const baseUpdate = {
    description: expense.description,
    amount: expense.amount,
    category: expense.category,
    spent_on: toIsoDate(expense.date),
    paid_by: paidBy,
    split_type: expense.splitType ?? 'equal',
    currency: expense.currency ?? 'EUR',
    notes: expense.notes ?? null,
  };

  let { data, error } = await ctx.supabase
    .from('expenses')
    .update(baseUpdate)
    .eq('id', id)
    .eq('trip_id', ctx.tripId)
    .select('*')
    .single();

  if (error && /split_type|currency|notes/i.test(error.message || '')) {
    ({ data, error } = await ctx.supabase
      .from('expenses')
      .update({
        description: expense.description,
        amount: expense.amount,
        category: expense.category,
        spent_on: toIsoDate(expense.date),
        paid_by: paidBy,
      })
      .eq('id', id)
      .eq('trip_id', ctx.tripId)
      .select('*')
      .single());
  }
  if (error) throw error;

  await ctx.supabase.from('expense_splits').delete().eq('expense_id', id);

  if (splitRows.length) {
    const splitPayload = splitRows.map((row) => ({ expense_id: id, ...row }));
    let { error: splitError } = await ctx.supabase.from('expense_splits').insert(splitPayload);
    if (splitError && /share_count|split_amount/i.test(splitError.message || '')) {
      ({ error: splitError } = await ctx.supabase.from('expense_splits').insert(
        splitRows.map((row) => ({ expense_id: id, user_id: row.user_id }))
      ));
    }
    if (splitError) throw splitError;
  }

  return mapExpenseRow({
    ...data,
    expense_splits: splitRows.map((row) => ({
      user_id: row.user_id,
      share_count: row.share_count,
      split_amount: row.split_amount,
    })),
    split_type: expense.splitType ?? 'equal',
    currency: expense.currency ?? 'EUR',
    notes: expense.notes ?? null,
  });
}

export async function deleteExpense(ctx: CloudContext, id: string) {
  const { error } = await ctx.supabase.from('expenses').delete().eq('id', id).eq('trip_id', ctx.tripId);
  if (error) throw error;
}

async function uploadWaypointPhotos(ctx: CloudContext, photos: string[] | undefined) {
  const paths: string[] = [];
  for (const [index, source] of (photos ?? []).entries()) {
    const path = await uploadPhotoBlob(ctx.supabase, ctx.tripId, ctx.user.id, source, `waypoint-${index + 1}.jpg`);
    paths.push(path);
  }
  return paths;
}

export async function insertWaypoint(ctx: CloudContext, waypoint: Omit<Waypoint, 'id'> & { id?: string }) {
  let photoPaths: string[] = [];
  try {
    photoPaths = await uploadWaypointPhotos(ctx, waypoint.photos);
  } catch (err) {
    console.warn('Upload photos étape échoué (bucket manquant ?)', err);
  }

  const baseRow = {
    trip_id: ctx.tripId,
    position: waypoint.order,
    title: waypoint.title,
    location_name: waypoint.locationName,
    lat: waypoint.lat,
    lng: waypoint.lng,
    scheduled_on: waypoint.date ? toIsoDate(waypoint.date) : null,
    status: waypoint.status,
    notes: waypoint.notes ?? null,
    van_spot_type: waypoint.vanSpotType ?? null,
    amenities: waypoint.amenities ?? [],
  };

  let { data, error } = await ctx.supabase
    .from('waypoints')
    .insert({ ...baseRow, photo_urls: photoPaths })
    .select('*')
    .single();

  // DB not yet migrated: retry without photo_urls.
  if (error && /photo_urls/i.test(error.message || '')) {
    ({ data, error } = await ctx.supabase.from('waypoints').insert(baseRow).select('*').single());
  }
  if (error) throw error;
  return mapWaypoint(data, ctx.supabase);
}

export async function updateWaypointStatus(
  ctx: CloudContext,
  id: string,
  status: Waypoint['status']
) {
  const { error } = await ctx.supabase
    .from('waypoints')
    .update({ status })
    .eq('id', id)
    .eq('trip_id', ctx.tripId);
  if (error) throw error;
}

export async function deleteWaypoint(ctx: CloudContext, id: string) {
  const { error } = await ctx.supabase.from('waypoints').delete().eq('id', id).eq('trip_id', ctx.tripId);
  if (error) throw error;
}

export async function reorderWaypoint(ctx: CloudContext, waypoints: Waypoint[]) {
  // Unique (trip_id, position): move to temporary negative slots, then apply final order.
  for (let i = 0; i < waypoints.length; i++) {
    const { error } = await ctx.supabase
      .from('waypoints')
      .update({ position: -(i + 1) })
      .eq('id', waypoints[i].id)
      .eq('trip_id', ctx.tripId);
    if (error) throw error;
  }
  for (const wp of waypoints) {
    const { error } = await ctx.supabase
      .from('waypoints')
      .update({ position: wp.order })
      .eq('id', wp.id)
      .eq('trip_id', ctx.tripId);
    if (error) throw error;
  }
}

export async function replaceWaypoints(ctx: CloudContext, waypoints: Omit<Waypoint, 'id'>[]) {
  const { error: delError } = await ctx.supabase.from('waypoints').delete().eq('trip_id', ctx.tripId);
  if (delError) throw delError;

  if (!waypoints.length) return [] as Waypoint[];

  const rowsWithPhotos = [];
  const rowsWithoutPhotos = [];
  for (const wp of waypoints) {
    let photoPaths: string[] = [];
    try {
      photoPaths = await uploadWaypointPhotos(ctx, wp.photos);
    } catch {
      photoPaths = [];
    }
    const base = {
      trip_id: ctx.tripId,
      position: wp.order,
      title: wp.title,
      location_name: wp.locationName,
      lat: wp.lat,
      lng: wp.lng,
      scheduled_on: wp.date ? toIsoDate(wp.date) : null,
      status: wp.status,
      notes: wp.notes ?? null,
      van_spot_type: wp.vanSpotType ?? null,
      amenities: wp.amenities ?? [],
    };
    rowsWithoutPhotos.push(base);
    rowsWithPhotos.push({ ...base, photo_urls: photoPaths });
  }

  let { data, error } = await ctx.supabase
    .from('waypoints')
    .insert(rowsWithPhotos)
    .select('*')
    .order('position', { ascending: true });
  if (error && /photo_urls/i.test(error.message || '')) {
    ({ data, error } = await ctx.supabase
      .from('waypoints')
      .insert(rowsWithoutPhotos)
      .select('*')
      .order('position', { ascending: true }));
  }
  if (error) throw error;
  return Promise.all((data ?? []).map((row) => mapWaypoint(row, ctx.supabase)));
}

async function mapWaypoint(row: any, supabase?: SupabaseClient): Promise<Waypoint> {
  const rawPhotos: string[] = Array.isArray(row.photo_urls) ? row.photo_urls : [];
  const photos = supabase
    ? (await Promise.all(rawPhotos.map((path) => resolvePhotoUrl(path, supabase)))).filter(Boolean)
    : rawPhotos;
  return {
    id: row.id,
    order: row.position,
    title: row.title,
    locationName: row.location_name,
    lat: row.lat,
    lng: row.lng,
    date: row.scheduled_on ? toIsoDate(row.scheduled_on) : undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    vanSpotType: row.van_spot_type ?? undefined,
    amenities: row.amenities ?? [],
    photos: photos.length ? photos : undefined,
  };
}

async function insertTrackPoints(ctx: CloudContext, trackId: string, points: GpsPoint[]) {
  for (let i = 0; i < points.length; i += POINT_CHUNK) {
    const chunk = points.slice(i, i + POINT_CHUNK).map((p) => ({
      track_id: trackId,
      recorded_at: new Date(p.timestamp).toISOString(),
      lat: p.lat,
      lng: p.lng,
      altitude_m: p.altitude ?? null,
      speed_kmh: p.speed ?? null,
    }));
    const { error } = await ctx.supabase.from('gps_track_points').insert(chunk);
    if (error) throw error;
  }
}

export async function insertTrack(ctx: CloudContext, track: Omit<GpsTrack, 'id'> & { id?: string }) {
  const memberIds = new Set(await loadMemberIds(ctx));
  const createdBy = asMemberId(track.createdByFriendId, ctx.user.id, memberIds);
  const { data, error } = await ctx.supabase
    .from('gps_tracks')
    .insert({
      trip_id: ctx.tripId,
      created_by: createdBy,
      title: track.title,
      tracked_on: toIsoDate(track.date),
      started_at: new Date(track.startTime).toISOString(),
      ended_at: track.endTime ? new Date(track.endTime).toISOString() : null,
      distance_km: track.distanceKm,
      avg_speed_kmh: track.avgSpeedKmH,
      max_speed_kmh: track.maxSpeedKmH,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (track.points?.length) {
    await insertTrackPoints(ctx, data.id, track.points);
  }

  return {
    id: data.id,
    title: data.title,
    date: toIsoDate(data.tracked_on),
    startTime: new Date(data.started_at).getTime(),
    endTime: data.ended_at ? new Date(data.ended_at).getTime() : undefined,
    distanceKm: Number(data.distance_km),
    avgSpeedKmH: Number(data.avg_speed_kmh),
    maxSpeedKmH: Number(data.max_speed_kmh),
    createdByFriendId: data.created_by,
    points: track.points ?? [],
  } satisfies GpsTrack;
}

export async function deleteTrack(ctx: CloudContext, trackId: string) {
  const { error } = await ctx.supabase.from('gps_tracks').delete().eq('id', trackId).eq('trip_id', ctx.tripId);
  if (error) throw error;
}

export async function upsertLiveLocation(
  ctx: CloudContext,
  coords: { lat: number; lng: number; altitude?: number; battery?: number }
) {
  const { error } = await ctx.supabase.from('member_locations').upsert(
    {
      trip_id: ctx.tripId,
      user_id: ctx.user.id,
      lat: coords.lat,
      lng: coords.lng,
      altitude_m: coords.altitude ?? null,
      battery: coords.battery ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'trip_id,user_id' }
  );
  if (error) throw error;
}

export type LiveLocationRow = {
  user_id: string;
  lat: number;
  lng: number;
  battery?: number | null;
  updated_at?: string;
};

export async function fetchLiveLocations(ctx: CloudContext): Promise<LiveLocationRow[]> {
  const { data, error } = await ctx.supabase
    .from('member_locations')
    .select('user_id, lat, lng, battery, updated_at')
    .eq('trip_id', ctx.tripId);
  if (error) throw error;
  return (data ?? []) as LiveLocationRow[];
}

export function mergeLiveLocationsIntoFriends(friends: Friend[], rows: LiveLocationRow[]) {
  const byUser = new Map(rows.map((row) => [row.user_id, row]));
  return friends.map((friend) => {
    const row = byUser.get(friend.id);
    if (!row) return friend;
    const lastActiveAt = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
    return {
      ...friend,
      liveLat: row.lat,
      liveLng: row.lng,
      battery: row.battery ?? friend.battery,
      lastActiveAt,
      lastActive: formatLastActive(lastActiveAt),
    };
  });
}

export async function updateOwnProfile(
  ctx: CloudContext,
  patch: { name?: string; avatar?: string; color?: string; role?: string }
) {
  const { error } = await ctx.supabase
    .from('profiles')
    .update({
      name: patch.name,
      avatar_url: patch.avatar,
      color: patch.color,
      role_label: patch.role,
    })
    .eq('id', ctx.user.id);
  if (error) throw error;
}

async function loadMemberIds(ctx: CloudContext) {
  const { data, error } = await ctx.supabase
    .from('trip_members')
    .select('user_id')
    .eq('trip_id', ctx.tripId);
  if (error) throw error;
  return (data ?? []).map((r) => r.user_id as string);
}

/**
 * Push local-only rows to Supabase, then return the authoritative remote bundle.
 * Dedupes by fingerprint so we don't duplicate when remote already has the same item.
 */
export async function syncLocalDataToCloud(
  ctx: CloudContext,
  local: {
    pois: Poi[];
    waypoints: Waypoint[];
    journal: JournalNote[];
    photos: TripPhoto[];
    expenses: Expense[];
    tracks: GpsTrack[];
  }
) {
  const remote = await loadTripBundle(ctx);
  let pushed = 0;
  const errors: string[] = [];

  const remotePoiKeys = new Set(remote.pois.map(poiFingerprint));
  for (const poi of local.pois) {
    if (!isLocalOnlyId(poi.id) && remote.pois.some((r) => r.id === poi.id)) continue;
    if (remotePoiKeys.has(poiFingerprint(poi))) continue;
    try {
      const saved = await insertPoi(ctx, { ...poi, createdByFriendId: ctx.user.id });
      remotePoiKeys.add(poiFingerprint(saved));
      pushed += 1;
    } catch (err: any) {
      errors.push(`POI: ${err?.message || err}`);
    }
  }

  const remoteWpKeys = new Set(remote.waypoints.map(waypointFingerprint));
  const localOnlyWaypoints = local.waypoints.filter((wp) => {
    if (!isLocalOnlyId(wp.id) && remote.waypoints.some((r) => r.id === wp.id)) return false;
    return !remoteWpKeys.has(waypointFingerprint(wp));
  });
  if (localOnlyWaypoints.length && !remote.waypoints.length) {
    try {
      await replaceWaypoints(
        ctx,
        localOnlyWaypoints.map((w, i) => ({ ...w, order: w.order || i + 1 }))
      );
      pushed += localOnlyWaypoints.length;
    } catch (err: any) {
      errors.push(`Waypoints: ${err?.message || err}`);
    }
  } else {
    for (const [index, wp] of localOnlyWaypoints.entries()) {
      try {
        const saved = await insertWaypoint(ctx, {
          ...wp,
          order: wp.order || remote.waypoints.length + index + 1,
        });
        remoteWpKeys.add(waypointFingerprint(saved));
        pushed += 1;
      } catch (err: any) {
        errors.push(`Étape: ${err?.message || err}`);
      }
    }
  }

  const remoteJournalKeys = new Set(remote.journal.map(journalFingerprint));
  for (const note of local.journal) {
    if (!isLocalOnlyId(note.id) && remote.journal.some((r) => r.id === note.id)) continue;
    if (remoteJournalKeys.has(journalFingerprint(note))) continue;
    try {
      const saved = await insertJournalNote(ctx, { ...note, friendId: ctx.user.id });
      remoteJournalKeys.add(journalFingerprint(saved));
      pushed += 1;
    } catch (err: any) {
      errors.push(`Journal: ${err?.message || err}`);
    }
  }

  const remotePhotoKeys = new Set(remote.photos.map(photoFingerprint));
  for (const photo of local.photos) {
    if (!isLocalOnlyId(photo.id) && remote.photos.some((r) => r.id === photo.id)) continue;
    if (remotePhotoKeys.has(photoFingerprint(photo))) continue;
    // Skip empty / broken local placeholders.
    if (!photo.url) continue;
    try {
      const saved = await insertPhoto(ctx, { ...photo, friendId: ctx.user.id });
      remotePhotoKeys.add(photoFingerprint(saved));
      pushed += 1;
    } catch (err: any) {
      errors.push(`Photo: ${err?.message || err}`);
    }
  }

  const remoteExpenseKeys = new Set(remote.expenses.map(expenseFingerprint));
  for (const expense of local.expenses) {
    if (!isLocalOnlyId(expense.id) && remote.expenses.some((r) => r.id === expense.id)) continue;
    if (remoteExpenseKeys.has(expenseFingerprint(expense))) continue;
    try {
      const saved = await insertExpense(ctx, {
        ...expense,
        paidByFriendId: ctx.user.id,
        splitAmongFriendIds: expense.splitAmongFriendIds?.length
          ? expense.splitAmongFriendIds
          : [ctx.user.id],
      });
      remoteExpenseKeys.add(expenseFingerprint(saved));
      pushed += 1;
    } catch (err: any) {
      errors.push(`Dépense: ${err?.message || err}`);
    }
  }

  const remoteTrackKeys = new Set(remote.tracks.map(trackFingerprint));
  for (const track of local.tracks) {
    if (!isLocalOnlyId(track.id) && remote.tracks.some((r) => r.id === track.id)) continue;
    if (remoteTrackKeys.has(trackFingerprint(track))) continue;
    if (!track.points?.length) continue;
    try {
      const saved = await insertTrack(ctx, { ...track, createdByFriendId: ctx.user.id });
      remoteTrackKeys.add(trackFingerprint(saved));
      pushed += 1;
    } catch (err: any) {
      errors.push(`Trace GPS: ${err?.message || err}`);
    }
  }

  if (errors.length) {
    console.warn('Sync locale → Supabase partielle:', errors);
  }
  if (pushed > 0) {
    console.info(`Sync locale → Supabase: ${pushed} élément(s) poussé(s).`);
  }

  return loadTripBundle(ctx);
}

/** @deprecated use syncLocalDataToCloud */
export async function migrateLocalBundleIfEmpty(
  ctx: CloudContext,
  local: {
    pois: Poi[];
    waypoints: Waypoint[];
    journal: JournalNote[];
    photos: TripPhoto[];
    expenses: Expense[];
    tracks: GpsTrack[];
  }
) {
  return syncLocalDataToCloud(ctx, local);
}

export type RealtimeSyncStatus = 'connecting' | 'connected' | 'disconnected';

export function subscribeTripRealtime(
  ctx: CloudContext,
  handlers: {
    onDataChange: () => void;
    onLocationChange?: (row: LiveLocationRow | null, eventType: string) => void;
    onStatusChange?: (status: RealtimeSyncStatus) => void;
  } | (() => void)
) {
  const normalized =
    typeof handlers === 'function'
      ? { onDataChange: handlers, onLocationChange: undefined, onStatusChange: undefined }
      : handlers;

  let activeChannel: ReturnType<SupabaseClient['channel']> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const notifyStatus = (status: RealtimeSyncStatus) => {
    normalized.onStatusChange?.(status);
  };

  const subscribe = () => {
    if (disposed) return;
    notifyStatus('connecting');

    const channel = ctx.supabase
      .channel(`trip-${ctx.tripId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pois', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waypoints', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'journal_notes', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photos', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_tracks', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter: `trip_id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `id=eq.${ctx.tripId}` }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_splits' }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gps_track_points' }, normalized.onDataChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, normalized.onDataChange)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_locations', filter: `trip_id=eq.${ctx.tripId}` },
        (payload) => {
          if (!normalized.onLocationChange) {
            normalized.onDataChange();
            return;
          }
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as LiveLocationRow | undefined;
            normalized.onLocationChange(oldRow ? { ...oldRow, lat: Number.NaN, lng: Number.NaN } : null, 'DELETE');
            return;
          }
          const row = payload.new as LiveLocationRow;
          normalized.onLocationChange(row, payload.eventType);
        }
      )
      .subscribe((status) => {
        if (disposed) return;
        if (status === 'SUBSCRIBED') {
          notifyStatus('connected');
          normalized.onDataChange();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          notifyStatus('disconnected');
          if (activeChannel) {
            void ctx.supabase.removeChannel(activeChannel);
            activeChannel = null;
          }
          reconnectTimer = setTimeout(subscribe, 3_000);
        }
      });

    activeChannel = channel;
  };

  subscribe();

  return () => {
    disposed = true;
    clearTimeout(reconnectTimer);
    if (activeChannel) {
      void ctx.supabase.removeChannel(activeChannel);
      activeChannel = null;
    }
  };
}

export function isCloudConfigured() {
  return Boolean(getSupabaseClient());
}

/** Detect missing SQL migrations so the UI can prompt to run ensure_full_sync.sql */
export async function verifyCloudSchema(ctx: CloudContext): Promise<string[]> {
  const issues: string[] = [];

  const { error: wpError } = await ctx.supabase.from('waypoints').select('photo_urls').limit(1);
  if (wpError && /photo_urls/i.test(wpError.message || '')) {
    issues.push('Colonne waypoints.photo_urls manquante');
  }

  const { error: inviteError } = await ctx.supabase.from('trips').select('invite_code').limit(1);
  if (inviteError && /invite_code/i.test(inviteError.message || '')) {
    issues.push('Colonne trips.invite_code manquante');
  }

  const { error: bucketError } = await ctx.supabase.storage.from('trip-photos').list('', {
    limit: 1,
  });
  if (bucketError && /not found|NoSuchBucket|Bucket not found/i.test(bucketError.message || '')) {
    issues.push('Bucket Storage trip-photos manquant');
  }

  const { error: expenseSplitError } = await ctx.supabase
    .from('expense_splits')
    .select('share_count, split_amount')
    .limit(1);
  if (expenseSplitError && /share_count|split_amount/i.test(expenseSplitError.message || '')) {
    issues.push('Colonnes expense_splits.share_count / split_amount manquantes');
  }

  const { error: expenseMetaError } = await ctx.supabase
    .from('expenses')
    .select('split_type, currency, notes')
    .limit(1);
  if (expenseMetaError && /split_type|currency|notes/i.test(expenseMetaError.message || '')) {
    issues.push('Colonnes expenses.split_type / currency / notes manquantes');
  }

  return issues;
}

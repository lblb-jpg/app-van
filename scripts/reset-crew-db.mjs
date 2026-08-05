/**
 * Vide toutes les données voyage, recrée un trip équipage sain,
 * joint Paul/Yanis en éditeurs, migre les avatars base64 → Storage.
 *
 * Usage: node scripts/reset-crew-db.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ws from 'ws';

function loadEnv() {
  const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  const env = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
  process.exit(1);
}

const CREW = [
  { name: 'Adel', email: 'adel@vanlife.local', password: 'vanlife-adel-roadtrip-2026' },
  { name: 'Paul', email: 'paul@vanlife.local', password: 'vanlife-paul-roadtrip-2026' },
  { name: 'Yanis', email: 'yanis@vanlife.local', password: 'vanlife-yanis-roadtrip-2026' },
];

const TABLES = [
  'gps_track_points',
  'gps_tracks',
  'expense_splits',
  'expenses',
  'photos',
  'journal_notes',
  'waypoints',
  'pois',
  'member_locations',
];

function client() {
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in ${email}: ${error.message}`);
  return { sb, user: data.user };
}

async function wipeTripContent(sb, tripId) {
  for (const table of TABLES) {
    const { error } = await sb.from(table).delete().eq('trip_id', tripId);
    if (error) console.warn(`  delete ${table}: ${error.message}`);
  }
  const { error: memErr } = await sb.from('trip_members').delete().eq('trip_id', tripId);
  if (memErr) console.warn(`  delete trip_members: ${memErr.message}`);
  const { error: tripErr } = await sb.from('trips').delete().eq('id', tripId);
  if (tripErr) console.warn(`  delete trip: ${tripErr.message}`);
}

async function listMembershipTrips(sb, userId) {
  const { data, error } = await sb
    .from('trip_members')
    .select('trip_id')
    .eq('user_id', userId);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.trip_id))];
}

async function listOwnedTrips(sb, userId) {
  const { data, error } = await sb.from('trips').select('id').eq('owner_id', userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

function decodeDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { contentType: m[1], buf: Buffer.from(m[2], 'base64') };
}

async function migrateAvatar(sb, userId, tripId) {
  // Slim JWT first — oversized avatar_url in metadata breaks Storage (HTTP 400).
  await sb.auth.updateUser({ data: { avatar_url: '' } });

  const { data: profile, error } = await sb
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  const avatar = profile?.avatar_url;
  if (!avatar?.startsWith('data:image/')) {
    console.log(`  avatar already OK (${avatar?.slice(0, 48) || 'empty'}…)`);
    return avatar || null;
  }
  const decoded = decodeDataUrl(avatar);
  if (!decoded) throw new Error('avatar data url illisible');
  console.log(`  migrating data: avatar (${Math.round(decoded.buf.length / 1024)} KB)…`);
  const path = `${tripId}/${userId}/avatar.jpg`;
  const { error: upErr } = await sb.storage.from('trip-photos').upload(path, decoded.buf, {
    contentType: decoded.contentType.includes('png') ? 'image/png' : 'image/jpeg',
    upsert: true,
  });
  if (upErr) throw upErr;
  const { data: pub } = sb.storage.from('trip-photos').getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  const { error: updErr } = await sb
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', userId);
  if (updErr) throw updErr;
  await sb.auth.updateUser({ data: { avatar_url: publicUrl } });
  console.log(`  → ${publicUrl.slice(0, 80)}…`);
  return publicUrl;
}

async function main() {
  console.log('=== RESET CREW DB ===');

  // 1) Adel wipes everything he can see
  const adel = await signIn(CREW[0].email, CREW[0].password);
  console.log('Signed in as Adel', adel.user.id);

  const tripIds = new Set([
    ...(await listMembershipTrips(adel.sb, adel.user.id)),
    ...(await listOwnedTrips(adel.sb, adel.user.id)),
  ]);

  // Also collect trips from Paul/Yanis memberships
  for (const member of CREW.slice(1)) {
    const sess = await signIn(member.email, member.password);
    for (const id of await listMembershipTrips(sess.sb, sess.user.id)) tripIds.add(id);
    await sess.sb.auth.signOut();
  }

  // Re-auth Adel for deletes (owner usually needed)
  const adel2 = await signIn(CREW[0].email, CREW[0].password);
  console.log(`Wiping ${tripIds.size} trip(s)…`);
  for (const tripId of tripIds) {
    console.log(' wipe', tripId);
    await wipeTripContent(adel2.sb, tripId);
  }

  // Extra: delete any remaining trips Adel owns
  for (const tripId of await listOwnedTrips(adel2.sb, adel2.user.id)) {
    console.log(' wipe leftover owned', tripId);
    await wipeTripContent(adel2.sb, tripId);
  }

  // 2) Create clean shared trip
  const { data: created, error: createErr } = await adel2.sb
    .from('trips')
    .insert({
      name: 'Road Trip Van — Équipage',
      description: 'Voyage partagé Adel · Paul · Yanis',
      owner_id: adel2.user.id,
    })
    .select('id, invite_code')
    .single();
  if (createErr) throw createErr;

  let tripId = created.id;
  let invite = (created.invite_code || tripId.replace(/-/g, '').slice(0, 8)).toUpperCase();

  // Ensure Adel membership as owner
  await adel2.sb.from('trip_members').upsert(
    { trip_id: tripId, user_id: adel2.user.id, member_role: 'owner' },
    { onConflict: 'trip_id,user_id' }
  );

  // Refresh invite if needed
  const { data: tripRow } = await adel2.sb
    .from('trips')
    .select('invite_code')
    .eq('id', tripId)
    .maybeSingle();
  if (tripRow?.invite_code) invite = String(tripRow.invite_code).toUpperCase();

  console.log('NEW TRIP', tripId);
  console.log('INVITE', invite);

  // 3) Paul & Yanis join as editors
  for (const member of CREW.slice(1)) {
    const sess = await signIn(member.email, member.password);
    const { data: joined, error: joinErr } = await sess.sb.rpc('join_trip_by_code', {
      invite,
    });
    if (joinErr) console.warn(`join ${member.name}:`, joinErr.message);
    else console.log(`joined ${member.name} →`, joined);

    await sess.sb
      .from('trip_members')
      .update({ member_role: 'editor' })
      .eq('trip_id', tripId)
      .eq('user_id', sess.user.id);

    // If update blocked by RLS, try upsert
    const { data: role } = await sess.sb
      .from('trip_members')
      .select('member_role')
      .eq('trip_id', tripId)
      .eq('user_id', sess.user.id)
      .maybeSingle();
    console.log(`  ${member.name} role:`, role?.member_role);

    await migrateAvatar(sess.sb, sess.user.id, tripId);
    await sess.sb.auth.signOut();
  }

  // 4) Adel avatar migrate + force editor-equivalent (keep owner label)
  await migrateAvatar(adel2.sb, adel2.user.id, tripId);

  // Verify members
  const { data: members } = await adel2.sb
    .from('trip_members')
    .select('user_id, member_role, profiles(name, avatar_url)')
    .eq('trip_id', tripId);

  console.log('\n=== MEMBERS ===');
  for (const m of members ?? []) {
    const name = m.profiles?.name;
    const av = m.profiles?.avatar_url || '';
    const kind = av.startsWith('http') ? 'http' : av.startsWith('data:') ? 'data' : av ? 'other' : 'empty';
    console.log(`- ${name}: ${m.member_role} | avatar=${kind} (${av.slice(0, 60)})`);
  }

  // Count leftover trips
  const { data: leftover } = await adel2.sb.from('trips').select('id, name');
  console.log('\nTrips still visible to Adel:', leftover?.length ?? 0, leftover);

  console.log('\n=== DONE ===');
  console.log('TRIP_ID=' + tripId);
  console.log('INVITE_CODE=' + invite);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * 1) Retire les avatars base64 du JWT (user_metadata) — cause du 400 Storage + sync lente
 * 2) Upload avatars vers Storage avec un token léger
 * 3) Met à jour profiles.avatar_url
 * 4) Supprime les vieux trips (chaque owner)
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
const TRIP = 'acf77e77-a32b-4099-9a71-8831d77f9692';
const INVITE = 'ACF77E77';

const CREW = [
  { name: 'Adel', email: 'adel@vanlife.local', password: 'vanlife-adel-roadtrip-2026' },
  { name: 'Paul', email: 'paul@vanlife.local', password: 'vanlife-paul-roadtrip-2026' },
  { name: 'Yanis', email: 'yanis@vanlife.local', password: 'vanlife-yanis-roadtrip-2026' },
];

function client() {
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws },
  });
}

function decodeDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { contentType: m[1], buf: Buffer.from(m[2], 'base64') };
}

async function signIn(email, password) {
  const sb = client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { sb, user: data.user, session: data.session };
}

async function wipeTrip(sb, tripId) {
  const { data: tracks } = await sb.from('gps_tracks').select('id').eq('trip_id', tripId);
  for (const t of tracks ?? []) {
    await sb.from('gps_track_points').delete().eq('track_id', t.id);
  }
  const { data: expenses } = await sb.from('expenses').select('id').eq('trip_id', tripId);
  for (const e of expenses ?? []) {
    await sb.from('expense_splits').delete().eq('expense_id', e.id);
  }
  for (const table of [
    'gps_tracks',
    'expenses',
    'photos',
    'journal_notes',
    'waypoints',
    'pois',
    'member_locations',
  ]) {
    await sb.from(table).delete().eq('trip_id', tripId);
  }
  await sb.from('trip_members').delete().eq('trip_id', tripId);
  const { error, count } = await sb.from('trips').delete({ count: 'exact' }).eq('id', tripId);
  console.log(`  delete trip ${tripId}:`, error?.message || `ok count=${count}`);
}

async function main() {
  // Pass 1: strip heavy metadata from every crew JWT + cache avatar bytes
  const avatars = new Map(); // userId -> {contentType, buf} | http url

  for (const member of CREW) {
    const sess = await signIn(member.email, member.password);
    const tokenLen = sess.session.access_token.length;
    console.log(`${member.name} token before: ${tokenLen} chars`);

    const { data: profile } = await sess.sb
      .from('profiles')
      .select('avatar_url')
      .eq('id', sess.user.id)
      .maybeSingle();

    const avatar = profile?.avatar_url || sess.user.user_metadata?.avatar_url || '';
    if (avatar.startsWith('data:image/')) {
      const decoded = decodeDataUrl(avatar);
      if (decoded) avatars.set(sess.user.id, decoded);
    } else if (avatar.startsWith('http')) {
      avatars.set(sess.user.id, { url: avatar });
    }

    // CRITICAL: remove base64 from JWT
    const { error: metaErr } = await sess.sb.auth.updateUser({
      data: {
        name: member.name,
        avatar_url: '', // short — never put data: here
      },
    });
    if (metaErr) console.warn('meta clear failed', metaErr.message);

    // Re-login to get slim token
    await sess.sb.auth.signOut();
    const slim = await signIn(member.email, member.password);
    console.log(`${member.name} token after: ${slim.session.access_token.length} chars`);

    // Ensure on shared trip as editor/owner
    await slim.sb.rpc('join_trip_by_code', { invite: INVITE });
    const role = member.name === 'Adel' ? 'owner' : 'editor';
    await slim.sb
      .from('trip_members')
      .upsert(
        { trip_id: TRIP, user_id: slim.user.id, member_role: role },
        { onConflict: 'trip_id,user_id' }
      );

    // Upload avatar with slim token
    const cached = avatars.get(slim.user.id);
    if (cached?.buf) {
      const ext = cached.contentType.includes('png') ? 'png' : 'jpg';
      const path = `${TRIP}/${slim.user.id}/avatar.${ext}`;
      const { error: upErr } = await slim.sb.storage.from('trip-photos').upload(path, cached.buf, {
        contentType: cached.contentType.includes('png') ? 'image/png' : 'image/jpeg',
        upsert: true,
      });
      if (upErr) {
        console.error(`${member.name} upload failed:`, upErr.message, upErr);
      } else {
        const { data: pub } = slim.sb.storage.from('trip-photos').getPublicUrl(path);
        await slim.sb.from('profiles').update({ avatar_url: pub.publicUrl }).eq('id', slim.user.id);
        await slim.sb.auth.updateUser({ data: { name: member.name, avatar_url: pub.publicUrl } });
        console.log(`${member.name} avatar →`, pub.publicUrl);
      }
    } else if (cached?.url) {
      console.log(`${member.name} already http avatar`);
    } else {
      console.log(`${member.name} no avatar bytes`);
    }

    // Wipe trips this user owns (except canonical)
    const { data: owned } = await slim.sb.from('trips').select('id, name').eq('owner_id', slim.user.id);
    for (const t of owned ?? []) {
      if (t.id === TRIP) continue;
      console.log(`${member.name} wiping owned`, t.id, t.name);
      await wipeTrip(slim.sb, t.id);
    }

    await slim.sb.auth.signOut();
  }

  // Final verify as Adel
  const adel = await signIn(CREW[0].email, CREW[0].password);
  const { data: members } = await adel.sb
    .from('trip_members')
    .select('member_role, profiles(name, avatar_url)')
    .eq('trip_id', TRIP);
  console.log('\n=== FINAL MEMBERS ===');
  for (const m of members ?? []) {
    const av = m.profiles?.avatar_url || '';
    console.log(
      '-',
      m.profiles?.name,
      m.member_role,
      av.startsWith('http') ? 'HTTP' : av.startsWith('data:') ? 'DATA' : 'EMPTY',
      av.slice(0, 90)
    );
  }
  const { data: trips } = await adel.sb.from('trips').select('id, name, invite_code');
  console.log('\nTrips visible:', trips?.length, trips);
  console.log('INVITE=' + INVITE);
  console.log('TRIP=' + TRIP);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

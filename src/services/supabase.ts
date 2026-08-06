// Optional Supabase Integration Service
// Works seamlessly alongside local IndexedDB persistence
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';
import {
  CREW_DEFAULT_COLORS,
  resolveFriendAvatar,
} from '../lib/crewAvatars';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const DISPLAY_NAME_KEY = 'van_display_name_v1';
const CREW_USER_MAP_KEY = 'van_crew_user_map_v1';
const CREW_BOOTSTRAP_KEY = 'van_crew_bootstrap_at_v1';
const CREW_BOOTSTRAP_TTL_MS = 6 * 60 * 60 * 1000;

let client: SupabaseClient | null = null;
let clientKey: string | null = null;

export const CREW_MEMBER_NAMES = ['Adel', 'Paul', 'Yanis'] as const;
export type CrewMemberName = (typeof CREW_MEMBER_NAMES)[number];

export type CrewUserMap = Partial<Record<CrewMemberName, string>>;

export function getStoredCrewUserMap(): CrewUserMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(CREW_USER_MAP_KEY) || '{}') as CrewUserMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveCrewUserId(name: CrewMemberName, userId: string) {
  const map = getStoredCrewUserMap();
  map[name] = userId;
  try {
    localStorage.setItem(CREW_USER_MAP_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function resolveCrewNameByUserId(userId: string): CrewMemberName | undefined {
  const map = getStoredCrewUserMap();
  return CREW_MEMBER_NAMES.find((name) => map[name] === userId);
}

export function shouldRunCrewBootstrap() {
  try {
    const last = Number(localStorage.getItem(CREW_BOOTSTRAP_KEY) || 0);
    return !last || Date.now() - last > CREW_BOOTSTRAP_TTL_MS;
  } catch {
    return true;
  }
}

export function markCrewBootstrapDone() {
  try {
    localStorage.setItem(CREW_BOOTSTRAP_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

function stripQuotes(value: string) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function slugifyName(name: string) {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'voyageur';
}

/** Deterministic local credentials derived from the display name (no email UI). */
export function credentialsFromDisplayName(name: string) {
  const slug = slugifyName(name);
  return {
    slug,
    email: `${slug}@vanlife.local`,
    password: `vanlife-${slug}-roadtrip-2026`,
  };
}

export function getStoredDisplayName() {
  return localStorage.getItem(DISPLAY_NAME_KEY)?.trim() || '';
}

export function saveDisplayName(name: string) {
  localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
}

export function isCrewMemberName(name: string): name is CrewMemberName {
  return CREW_MEMBER_NAMES.some((memberName) => memberName.toLowerCase() === name.trim().toLowerCase());
}

export function isCrewAccount(user: User) {
  return CREW_MEMBER_NAMES.some(
    (name) => credentialsFromDisplayName(name).email === user.email?.toLowerCase()
  );
}

/** Returns the browser client configured from .env.local or the in-app settings. */
export function getSupabaseClient(): SupabaseClient | null {
  const config = getStoredSupabaseConfig();
  if (!config) return null;

  const cacheKey = `${config.url}::${config.anonKey.slice(0, 12)}`;
  if (!client || clientKey !== cacheKey) {
    client = createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    clientKey = cacheKey;
  }
  return client;
}

/**
 * Ensures a profiles row exists for the auth user.
 * Never overwrites a personalized name / avatar / color already stored in the cloud.
 */
async function upsertProfileName(supabase: SupabaseClient, userId: string, name: string) {
  const crewName = isCrewMemberName(name) ? name : undefined;
  const defaultColor = crewName ? CREW_DEFAULT_COLORS[crewName] : '#059669';
  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('name, avatar_url, color')
    .eq('id', userId)
    .maybeSingle();
  if (selectError) throw selectError;

  if (!existing) {
    const avatarUrl = resolveFriendAvatar(name, defaultColor, null);
    const { error } = await supabase.from('profiles').insert({
      id: userId,
      name,
      color: defaultColor,
      avatar_url: avatarUrl,
    });
    if (error) {
      // Race: another session may have created the row — continue to fill empties.
      console.warn('Profile insert raced', error.message);
    } else {
      const metaAvatar =
        avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://') ? avatarUrl : '';
      const { error: metaError } = await supabase.auth.updateUser({
        data: { name, avatar_url: metaAvatar },
      });
      if (metaError) throw metaError;
      return;
    }
  }

  const row = existing ?? (
    await supabase.from('profiles').select('name, avatar_url, color').eq('id', userId).maybeSingle()
  ).data;

  if (!row) {
    throw new Error('Profil cloud introuvable après connexion.');
  }

  const patch: { name?: string; color?: string; avatar_url?: string } = {};
  if (!row.name?.trim()) patch.name = name;
  if (!row.color?.trim()) patch.color = defaultColor;
  if (!row.avatar_url?.trim()) {
    patch.avatar_url = resolveFriendAvatar(row.name || name, row.color || defaultColor, null);
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
    if (error) throw error;
  }

  // JWT must stay small — only short https URLs (or empty). Preserve cloud display name.
  const finalName = (row.name?.trim() || patch.name || name).trim();
  const finalAvatar = row.avatar_url || patch.avatar_url || '';
  const metaAvatar =
    finalAvatar.startsWith('http://') || finalAvatar.startsWith('https://') ? finalAvatar : '';
  const { error: metaError } = await supabase.auth.updateUser({
    data: { name: finalName, avatar_url: metaAvatar },
  });
  if (metaError) throw metaError;
}

/**
 * Ensures that database requests carry an authenticated user.
 * Does not create a nameless session — use signInWithDisplayName() for first login.
 */
export async function ensureSupabaseSession(): Promise<{
  supabase: SupabaseClient | null;
  user: User | null;
  error: Error | null;
  needsAuth: boolean;
}> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return { supabase: null, user: null, error: new Error('Supabase non configuré'), needsAuth: false };
  }

  const { data: existing, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) return { supabase, user: null, error: sessionError, needsAuth: true };
  if (existing.session?.user) {
    if (isCrewAccount(existing.session.user)) {
      return { supabase, user: existing.session.user, error: null, needsAuth: false };
    }
    // Replace anonymous / legacy sessions with a crew password session.
    try {
      const user = await switchToCrewMember(resolvePreferredCrewName());
      return { supabase, user, error: null, needsAuth: false };
    } catch (err: any) {
      return {
        supabase,
        user: null,
        error: err instanceof Error ? err : new Error(String(err)),
        needsAuth: true,
      };
    }
  }

  const savedName = getStoredDisplayName();
  if (isCrewMemberName(savedName)) {
    try {
      const user = await switchToCrewMember(savedName);
      return { supabase, user, error: null, needsAuth: false };
    } catch (err: any) {
      return {
        supabase,
        user: null,
        error: err instanceof Error ? err : new Error(String(err)),
        needsAuth: true,
      };
    }
  }

  if (savedName) {
    try {
      const user = await signInWithDisplayName(savedName);
      return { supabase, user, error: null, needsAuth: false };
    } catch (err: any) {
      return { supabase, user: null, error: err instanceof Error ? err : new Error(String(err)), needsAuth: true };
    }
  }

  return {
    supabase,
    user: null,
    error: new Error('Choisis un prénom pour continuer'),
    needsAuth: true,
  };
}

/** One-field login: display name only. */
export async function signInWithDisplayName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Indique un prénom');

  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase non configuré');

  saveDisplayName(trimmed);

  if (isCrewMemberName(trimmed)) {
    return switchToCrewMember(trimmed);
  }

  // Reuse existing session when possible.
  {
    const { data: existing } = await supabase.auth.getSession();
    if (existing.session?.user) {
      await upsertProfileName(supabase, existing.session.user.id, trimmed);
      return existing.session.user;
    }
  }

  // Preferred path: anonymous auth + profile name (enabled in Supabase dashboard).
  {
    const { data, error } = await supabase.auth.signInAnonymously({
      options: { data: { name: trimmed } },
    });
    if (!error && data.user) {
      await upsertProfileName(supabase, data.user.id, trimmed);
      return data.user;
    }
  }

  const { email, password } = credentialsFromDisplayName(trimmed);

  // Fallback: deterministic email/password (no UI).
  {
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    if (!signedIn.error && signedIn.data.user) {
      await upsertProfileName(supabase, signedIn.data.user.id, trimmed);
      return signedIn.data.user;
    }

    const signedUp = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name: trimmed } },
    });
    if (!signedUp.error && signedUp.data.session?.user) {
      await upsertProfileName(supabase, signedUp.data.session.user.id, trimmed);
      return signedUp.data.session.user;
    }
  }

  throw new Error('Connexion impossible pour le moment. Réessaie dans un instant.');
}

export function resolvePreferredCrewName(): CrewMemberName {
  const savedName = getStoredDisplayName();
  return isCrewMemberName(savedName) ? savedName : 'Adel';
}

/** Connect with the fixed crew email/password accounts (primary auth path). */
export async function ensureCrewSession(name: CrewMemberName = resolvePreferredCrewName()) {
  return switchToCrewMember(name);
}

async function signInOrCreateCrewAccount(supabase: SupabaseClient, name: CrewMemberName) {
  const { email, password } = credentialsFromDisplayName(name);
  const signedIn = await supabase.auth.signInWithPassword({ email, password });
  if (!signedIn.error && signedIn.data.user) {
    await upsertProfileName(supabase, signedIn.data.user.id, name);
    return signedIn.data.user;
  }

  const signedUp = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (signedUp.error) {
    const retry = await supabase.auth.signInWithPassword({ email, password });
    if (!retry.error && retry.data.user) {
      await upsertProfileName(supabase, retry.data.user.id, name);
      return retry.data.user;
    }
    throw signedUp.error;
  }

  if (signedUp.data.session?.user) {
    await upsertProfileName(supabase, signedUp.data.session.user.id, name);
    return signedUp.data.session.user;
  }

  const retry = await supabase.auth.signInWithPassword({ email, password });
  if (!retry.error && retry.data.user) {
    await upsertProfileName(supabase, retry.data.user.id, name);
    return retry.data.user;
  }

  throw new Error(`Connexion ${name} impossible. Vérifie que l’email est autorisé dans Supabase.`);
}

/** Switches the active Supabase session to one of the three fixed crew accounts. */
export async function switchToCrewMember(name: CrewMemberName) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase non configuré');

  const { data: existing } = await supabase.auth.getSession();
  const targetEmail = credentialsFromDisplayName(name).email;
  if (existing.session?.user.email?.toLowerCase() === targetEmail) {
    saveDisplayName(name);
    saveCrewUserId(name, existing.session.user.id);
    await upsertProfileName(supabase, existing.session.user.id, name);
    return existing.session.user;
  }

  if (existing.session) await supabase.auth.signOut();
  const user = await signInOrCreateCrewAccount(supabase, name);
  saveDisplayName(name);
  saveCrewUserId(name, user.id);
  return user;
}

/**
 * Ensures each fixed crew account has a profile photo in Supabase
 * (without changing the active browser session).
 */
export async function backfillCrewProfileAvatars() {
  const config = getStoredSupabaseConfig();
  if (!config) return;

  for (const name of CREW_MEMBER_NAMES) {
    try {
      const isolated = createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      await signInOrCreateCrewAccount(isolated, name);
      await isolated.auth.signOut();
    } catch (err) {
      console.warn(`Avatar backfill ${name}:`, err);
    }
  }
}

/**
 * Creates the fixed crew accounts with isolated clients, then joins each one to
 * the current trip without replacing the active browser session.
 */
export async function ensureCrewAccounts(inviteCode: string) {
  const config = getStoredSupabaseConfig();
  if (!config) throw new Error('Supabase non configuré');

  const failures: string[] = [];
  for (const name of CREW_MEMBER_NAMES) {
    try {
      const isolated = createClient(config.url, config.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const user = await signInOrCreateCrewAccount(isolated, name);
      saveCrewUserId(name, user.id);
      const { error } = await isolated.rpc('join_trip_by_code', {
        invite: inviteCode.trim().toUpperCase(),
      });
      if (error) failures.push(`${name}: ${error.message}`);
      await isolated.auth.signOut();
    } catch (err: any) {
      failures.push(`${name}: ${err?.message || err}`);
    }
  }

  if (failures.length === CREW_MEMBER_NAMES.length) {
    throw new Error(failures[0] || 'Impossible de préparer les comptes équipage.');
  }
  if (failures.length) {
    console.warn('ensureCrewAccounts partial:', failures);
  }
}

export async function signOutSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  await supabase.auth.signOut();
}

export function getStoredSupabaseConfig(): SupabaseConfig | null {
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL as string | undefined;
  const envKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (envUrl && envKey) {
    return { url: stripQuotes(envUrl), anonKey: stripQuotes(envKey) };
  }

  const saved = localStorage.getItem('van_supabase_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as SupabaseConfig;
      return {
        url: stripQuotes(parsed.url),
        anonKey: stripQuotes(parsed.anonKey),
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function saveSupabaseConfig(config: SupabaseConfig) {
  localStorage.setItem(
    'van_supabase_config',
    JSON.stringify({
      url: stripQuotes(config.url),
      anonKey: stripQuotes(config.anonKey),
    })
  );
  client = null;
  clientKey = null;
}

export function clearSupabaseConfig() {
  localStorage.removeItem('van_supabase_config');
  client = null;
  clientKey = null;
}

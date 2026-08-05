// Optional Supabase Integration Service
// Works seamlessly alongside local IndexedDB persistence
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const DISPLAY_NAME_KEY = 'van_display_name_v1';

let client: SupabaseClient | null = null;
let clientKey: string | null = null;

export const CREW_MEMBER_NAMES = ['Adel', 'Paul', 'Yanis'] as const;
export type CrewMemberName = (typeof CREW_MEMBER_NAMES)[number];

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
    });
    clientKey = cacheKey;
  }
  return client;
}

async function upsertProfileName(supabase: SupabaseClient, userId: string, name: string) {
  const { error } = await supabase.from('profiles').upsert(
    {
      id: userId,
      name,
      color: '#059669',
    },
    { onConflict: 'id' }
  );
  if (error) {
    // Profile may already exist via trigger — try update only.
    await supabase.from('profiles').update({ name }).eq('id', userId);
  }
  await supabase.auth.updateUser({ data: { name } });
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
    return { supabase, user: existing.session.user, error: null, needsAuth: false };
  }

  const savedName = getStoredDisplayName();
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
  if (signedUp.error) throw signedUp.error;
  if (!signedUp.data.session?.user) {
    throw new Error(`Le compte ${name} doit être confirmé dans Supabase avant de continuer.`);
  }

  await upsertProfileName(supabase, signedUp.data.session.user.id, name);
  return signedUp.data.session.user;
}

/** Switches the active Supabase session to one of the three fixed crew accounts. */
export async function switchToCrewMember(name: CrewMemberName) {
  const supabase = getSupabaseClient();
  if (!supabase) throw new Error('Supabase non configuré');

  const { data: existing } = await supabase.auth.getSession();
  const targetEmail = credentialsFromDisplayName(name).email;
  if (existing.session?.user.email?.toLowerCase() === targetEmail) {
    saveDisplayName(name);
    return existing.session.user;
  }

  if (existing.session) await supabase.auth.signOut();
  const user = await signInOrCreateCrewAccount(supabase, name);
  saveDisplayName(name);
  return user;
}

/**
 * Creates the fixed crew accounts with isolated clients, then joins each one to
 * the current trip without replacing the active browser session.
 */
export async function ensureCrewAccounts(inviteCode: string) {
  const config = getStoredSupabaseConfig();
  if (!config) throw new Error('Supabase non configuré');

  for (const name of CREW_MEMBER_NAMES) {
    const isolated = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await signInOrCreateCrewAccount(isolated, name);
    const { error } = await isolated.rpc('join_trip_by_code', {
      invite: inviteCode.trim().toUpperCase(),
    });
    if (error) throw error;
    await isolated.auth.signOut();
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

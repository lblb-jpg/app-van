/** Persist browser permission grants so we stop nagging after the first accept. */

const GEO_GRANTED_KEY = 'van_geo_granted_v1';
const MIC_GRANTED_KEY = 'van_mic_granted_v1';
const AUDIO_UNLOCKED_KEY = 'van_audio_unlocked_v1';

export type PermissionStateLike = 'granted' | 'denied' | 'prompt' | 'unknown';

function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // ignore quota / private mode
  }
}

export function wasGeoGranted() {
  return readFlag(GEO_GRANTED_KEY);
}

export function markGeoGranted() {
  writeFlag(GEO_GRANTED_KEY, true);
}

export function wasMicGranted() {
  return readFlag(MIC_GRANTED_KEY);
}

export function markMicGranted() {
  writeFlag(MIC_GRANTED_KEY, true);
}

export function wasAudioUnlocked() {
  try {
    return sessionStorage.getItem(AUDIO_UNLOCKED_KEY) === '1' || localStorage.getItem(AUDIO_UNLOCKED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markAudioUnlocked() {
  try {
    sessionStorage.setItem(AUDIO_UNLOCKED_KEY, '1');
    localStorage.setItem(AUDIO_UNLOCKED_KEY, '1');
  } catch {
    // ignore
  }
}

async function queryPermission(name: PermissionName): Promise<PermissionStateLike> {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name });
    if (status.state === 'granted' || status.state === 'denied' || status.state === 'prompt') {
      return status.state;
    }
  } catch {
    // Safari / Firefox may reject some names (e.g. microphone).
  }
  return 'unknown';
}

export async function queryGeoPermission(): Promise<PermissionStateLike> {
  const state = await queryPermission('geolocation');
  if (state === 'granted') markGeoGranted();
  if (state === 'granted' || wasGeoGranted()) return 'granted';
  return state;
}

export async function queryMicPermission(): Promise<PermissionStateLike> {
  const state = await queryPermission('microphone' as PermissionName);
  if (state === 'granted') markMicGranted();
  if (state === 'granted' || wasMicGranted()) return 'granted';
  return state;
}

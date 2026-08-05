/** Persist browser permission grants so we stop nagging after the first accept. */

const GEO_GRANTED_KEY = 'van_geo_granted_v1';

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

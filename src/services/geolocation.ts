import { markGeoGranted, queryGeoPermission, wasGeoGranted } from '../lib/permissions';

export type GeoStatus =
  | { state: 'idle' }
  | { state: 'locating' }
  | { state: 'ready'; accuracyM?: number }
  | { state: 'error'; message: string; fatal?: boolean };

export function isGeolocationAvailable() {
  return typeof navigator !== 'undefined' && Boolean(navigator.geolocation);
}

export function geolocationErrorMessage(error: GeolocationPositionError) {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Autorise la localisation dans le navigateur pour afficher ta position.';
    case error.POSITION_UNAVAILABLE:
      return 'Position GPS indisponible. Vérifie que le GPS est activé.';
    case error.TIMEOUT:
      return 'Signal GPS faible — nouvel essai en cours…';
    default:
      return error.message || 'Impossible d’obtenir la position GPS.';
  }
}

export type GeoWatchOptions = {
  highAccuracy?: boolean;
  maximumAgeMs?: number;
  minEmitIntervalMs?: number;
  timeoutMs?: number;
};

const DEFAULT_GEO_OPTIONS: Required<GeoWatchOptions> = {
  highAccuracy: true,
  maximumAgeMs: 5_000,
  minEmitIntervalMs: 0,
  timeoutMs: 25_000,
};

export type GeoHandlers = {
  onPosition: (position: GeolocationPosition) => void;
  onStatus?: (status: GeoStatus) => void;
};

/**
 * Starts a resilient GPS session with configurable accuracy / cadence.
 * Prefer low-accuracy + long maximumAge when the app is in background.
 */
export function startGeolocationWatch(handlers: GeoHandlers, options: GeoWatchOptions = {}) {
  const watchOptions = { ...DEFAULT_GEO_OPTIONS, ...options };
  if (!isGeolocationAvailable()) {
    handlers.onStatus?.({
      state: 'error',
      message: 'La géolocalisation n’est pas supportée sur cet appareil.',
      fatal: true,
    });
    return () => undefined;
  }

  if (typeof window !== 'undefined' && !window.isSecureContext) {
    handlers.onStatus?.({
      state: 'error',
      message: 'La géolocalisation nécessite HTTPS (ou localhost).',
      fatal: true,
    });
    return () => undefined;
  }

  let cancelled = false;
  let watchId: number | null = null;
  let gotFix = false;
  let lastEmittedTs = 0;
  let alreadyGranted = wasGeoGranted();
  let started = false;

  handlers.onStatus?.({ state: 'locating' });

  const applyPosition = (position: GeolocationPosition) => {
    if (cancelled) return;

    const now = Date.now();
    const ts = position.timestamp || now;
    if (ts < lastEmittedTs - 250) return;
    if (watchOptions.minEmitIntervalMs > 0 && now - lastEmittedTs < watchOptions.minEmitIntervalMs) {
      return;
    }
    lastEmittedTs = now;

    gotFix = true;
    alreadyGranted = true;
    markGeoGranted();
    handlers.onPosition(position);
    const accuracy =
      position.coords.accuracy != null && Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : undefined;
    handlers.onStatus?.({ state: 'ready', accuracyM: accuracy });
  };

  const onError = (error: GeolocationPositionError) => {
    if (cancelled) return;
    const fatal = error.code === error.PERMISSION_DENIED;
    if (!fatal && gotFix) {
      handlers.onStatus?.({ state: 'ready' });
      return;
    }
    // Already authorized but temporary timeout: keep locating quietly.
    if (!fatal && alreadyGranted) {
      handlers.onStatus?.({ state: 'locating' });
      return;
    }
    handlers.onStatus?.({
      state: 'error',
      message: geolocationErrorMessage(error),
      fatal,
    });
  };

  const startWatch = (granted: boolean) => {
    if (cancelled || started) return;
    started = true;
    alreadyGranted = granted || alreadyGranted;
    // Warm start from cache when already authorized — avoids a fresh "permission" feel.
    navigator.geolocation.getCurrentPosition(applyPosition, onError, {
      enableHighAccuracy: watchOptions.highAccuracy && !granted,
      timeout: granted ? Math.min(watchOptions.timeoutMs, 12_000) : watchOptions.timeoutMs,
      maximumAge: granted ? watchOptions.maximumAgeMs : Math.min(watchOptions.maximumAgeMs, 15_000),
    });

    watchId = navigator.geolocation.watchPosition(applyPosition, onError, {
      enableHighAccuracy: watchOptions.highAccuracy,
      timeout: watchOptions.timeoutMs,
      maximumAge: watchOptions.maximumAgeMs,
    });
  };

  void queryGeoPermission().then((state) => {
    if (cancelled) return;
    if (state === 'denied' && !gotFix && !wasGeoGranted()) {
      handlers.onStatus?.({
        state: 'error',
        message:
          'Autorise la localisation dans le navigateur pour afficher ta position.',
        fatal: true,
      });
      return;
    }
    startWatch(state === 'granted' || wasGeoGranted());
  });

  // Fallback if Permissions API hangs / is unavailable.
  const fallbackTimer = window.setTimeout(() => {
    if (cancelled || started || gotFix) return;
    startWatch(wasGeoGranted());
  }, 350);

  return () => {
    cancelled = true;
    window.clearTimeout(fallbackTimer);
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
  };
}

/** Reverse-geocode coordinates to the nearest French commune (city/village). */
export async function reverseGeocodeCity(lat: number, lng: number, signal?: AbortSignal) {
  const url = new URL('https://api-adresse.data.gouv.fr/reverse/');
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) return null;

  const data = (await response.json()) as {
    features?: Array<{ properties?: { city?: string; name?: string; label?: string } }>;
  };

  const props = data.features?.[0]?.properties;
  if (!props) return null;

  return props.city?.trim() || props.name?.trim() || props.label?.split(',')[0]?.trim() || null;
}

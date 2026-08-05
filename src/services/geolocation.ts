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

export type GeoHandlers = {
  onPosition: (position: GeolocationPosition) => void;
  onStatus?: (status: GeoStatus) => void;
};

/**
 * Starts a resilient GPS session:
 * 1) fast coarse getCurrentPosition
 * 2) continuous high-accuracy watch (fresh fixes only)
 * Does not clear a previous good fix on timeout.
 */
export function startGeolocationWatch(handlers: GeoHandlers) {
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

  handlers.onStatus?.({ state: 'locating' });

  const applyPosition = (position: GeolocationPosition) => {
    if (cancelled) return;

    // Drop duplicate / out-of-order callbacks from the browser.
    const ts = position.timestamp || Date.now();
    if (ts < lastEmittedTs - 250) return;
    lastEmittedTs = ts;

    gotFix = true;
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
    // Keep last fix on timeout / temporary unavailability.
    if (!fatal && gotFix) {
      handlers.onStatus?.({ state: 'ready' });
      return;
    }
    handlers.onStatus?.({
      state: 'error',
      message: geolocationErrorMessage(error),
      fatal,
    });
  };

  navigator.geolocation.getCurrentPosition(applyPosition, onError, {
    enableHighAccuracy: true,
    timeout: 20_000,
    maximumAge: 15_000,
  });

  watchId = navigator.geolocation.watchPosition(applyPosition, onError, {
    enableHighAccuracy: true,
    timeout: 20_000,
    maximumAge: 0,
  });

  return () => {
    cancelled = true;
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
  };
}

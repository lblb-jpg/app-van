const STANDALONE_MODES = ['standalone', 'fullscreen', 'minimal-ui'] as const;

export function isStandalonePwa() {
  if (typeof window === 'undefined') return false;
  const media = STANDALONE_MODES.some((mode) =>
    window.matchMedia(`(display-mode: ${mode})`).matches
  );
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return media || iosStandalone;
}

export function isIosDevice() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isAndroidDevice() {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

export function isMobileDevice() {
  return isIosDevice() || isAndroidDevice();
}

export function applyPlatformClasses() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('platform-ios', isIosDevice());
  root.classList.toggle('platform-android', isAndroidDevice());
  root.classList.toggle('pwa-standalone', isStandalonePwa());
}

export function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  applyPlatformClasses();

  const register = () => {
    void navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed', err);
    });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

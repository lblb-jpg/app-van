import { useEffect, useRef } from 'react';

const OVERLAY_STATE = { vanOverlay: true };

/**
 * Maps the Android hardware back button (and browser back) to closing overlays.
 * Push a history entry while open; pop closes the overlay instead of leaving the app.
 */
export function useHistoryBack(active: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  const pushedRef = useRef(false);
  const closingViaBackRef = useRef(false);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) {
      if (pushedRef.current && !closingViaBackRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
      closingViaBackRef.current = false;
      return;
    }

    window.history.pushState(OVERLAY_STATE, '');
    pushedRef.current = true;

    const handlePopState = () => {
      closingViaBackRef.current = true;
      pushedRef.current = false;
      onBackRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (pushedRef.current && !closingViaBackRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
  }, [active]);
}

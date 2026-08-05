/** Délais par défaut — voir `lib/powerMode.ts` pour le profil adaptatif (carte / premier plan / arrière-plan). */
export const SYNC_DEBOUNCE_MS = 150;
/** Secours si Realtime est coupé — Realtime reste la source principale */
export const SYNC_FULL_INTERVAL_MS = 30_000;
/** Secours positions live — Realtime gère member_locations en priorité */
export const SYNC_LIVE_LOCATION_POLL_MS = 8_000;
export const SYNC_ACTIVE_LABEL_TICK_MS = 10_000;
export const SYNC_LIVE_LOCATION_PUSH_MS = 2_000;
export const SYNC_LIVE_LOCATION_MOVE_M = 12;

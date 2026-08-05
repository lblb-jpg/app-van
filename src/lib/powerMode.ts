import type { TabType } from '../types';

export type PowerTier = 'map' | 'foreground' | 'background';

export type PowerProfile = {
  tier: PowerTier;
  label: string;
  geoHighAccuracy: boolean;
  geoMaximumAgeMs: number;
  geoMinEmitIntervalMs: number;
  geoTimeoutMs: number;
  liveLocationPushMs: number;
  liveLocationMoveM: number;
  liveLocationPollMs: number;
  fullSyncMs: number;
  activeLabelTickMs: number;
  uiLocationUpdateMs: number;
  syncLocationsWhenHidden: boolean;
};

const MAP_PROFILE: PowerProfile = {
  tier: 'map',
  label: 'Carte active',
  geoHighAccuracy: true,
  geoMaximumAgeMs: 5_000,
  geoMinEmitIntervalMs: 1_000,
  geoTimeoutMs: 25_000,
  liveLocationPushMs: 2_000,
  liveLocationMoveM: 12,
  liveLocationPollMs: 8_000,
  fullSyncMs: 30_000,
  activeLabelTickMs: 10_000,
  uiLocationUpdateMs: 1_000,
  syncLocationsWhenHidden: true,
};

const FOREGROUND_PROFILE: PowerProfile = {
  tier: 'foreground',
  label: 'App ouverte',
  geoHighAccuracy: false,
  geoMaximumAgeMs: 30_000,
  geoMinEmitIntervalMs: 5_000,
  geoTimeoutMs: 20_000,
  liveLocationPushMs: 15_000,
  liveLocationMoveM: 25,
  liveLocationPollMs: 20_000,
  fullSyncMs: 60_000,
  activeLabelTickMs: 30_000,
  uiLocationUpdateMs: 5_000,
  syncLocationsWhenHidden: true,
};

const BACKGROUND_PROFILE: PowerProfile = {
  tier: 'background',
  label: 'Arrière-plan',
  geoHighAccuracy: false,
  geoMaximumAgeMs: 120_000,
  geoMinEmitIntervalMs: 30_000,
  geoTimeoutMs: 45_000,
  liveLocationPushMs: 90_000,
  liveLocationMoveM: 50,
  liveLocationPollMs: 90_000,
  fullSyncMs: 180_000,
  activeLabelTickMs: 0,
  uiLocationUpdateMs: 0,
  syncLocationsWhenHidden: true,
};

export function getPowerProfile(input: {
  documentVisible: boolean;
  activeTab: TabType;
}): PowerProfile {
  if (!input.documentVisible) return BACKGROUND_PROFILE;
  if (input.activeTab === 'map') return MAP_PROFILE;
  return FOREGROUND_PROFILE;
}

export function isDocumentVisible() {
  if (typeof document === 'undefined') return true;
  return document.visibilityState === 'visible';
}

type PowerModeListener = (profile: PowerProfile) => void;

let listeners = new Set<PowerModeListener>();
let bound = false;
let currentTab: TabType = 'map';

function notify() {
  const profile = getPowerProfile({
    documentVisible: isDocumentVisible(),
    activeTab: currentTab,
  });
  listeners.forEach((listener) => listener(profile));
}

function ensureBound() {
  if (bound || typeof document === 'undefined') return;
  bound = true;
  document.addEventListener('visibilitychange', notify);
}

export function setPowerModeTab(tab: TabType) {
  currentTab = tab;
  notify();
}

export function subscribePowerMode(listener: PowerModeListener) {
  ensureBound();
  listeners.add(listener);
  listener(
    getPowerProfile({
      documentVisible: isDocumentVisible(),
      activeTab: currentTab,
    })
  );
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && bound && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', notify);
      bound = false;
    }
  };
}

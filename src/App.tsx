import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import {
  Friend,
  Poi,
  JournalNote,
  Expense,
  TripPhoto,
  Waypoint,
  GpsPoint,
  GpsTrack,
  TabType,
  VanSleepSpot,
} from './types';
import { dbService } from './services/db';
import {
  bootstrapCloud,
  CloudContext,
  deleteExpense as cloudDeleteExpense,
  deleteAllExpenses as cloudDeleteAllExpenses,
  deletePhoto as cloudDeletePhoto,
  deleteWaypoint as cloudDeleteWaypoint,
  ensureSharedCrewTrip,
  insertExpense as cloudInsertExpense,
  updateExpense as cloudUpdateExpense,
  insertJournalNote as cloudInsertJournalNote,
  insertPhoto as cloudInsertPhoto,
  insertPoi as cloudInsertPoi,
  insertWaypoint as cloudInsertWaypoint,
  isCloudConfigured,
  fetchLiveLocations,
  formatLastActive,
  loadTripBundle,
  mergeLiveLocationsIntoFriends,
  type LoadTripBundleOptions,
  migrateProfileAvatarsToStorage,
  saveCrewInviteCode,
  syncLocalDataToCloud,
  verifyCloudSchema,
  reorderWaypoint as cloudReorderWaypoint,
  setActiveTripId,
  subscribeTripRealtime,
  updateWaypointStatus as cloudUpdateWaypointStatus,
  updateOwnProfile,
  upsertLiveLocation,
  insertTrack,
  insertTrackPoints,
  updateTrackStats,
  deletePoi as cloudDeletePoi,
  deleteJournalNote as cloudDeleteJournalNote,
  updatePoi as cloudUpdatePoi,
  updateJournalNote as cloudUpdateJournalNote,
  updateWaypoint as cloudUpdateWaypoint,
} from './services/supabaseRepo';
import { SYNC_DEBOUNCE_MS } from './services/syncConfig';
import {
  getPowerProfile,
  isDocumentVisible,
  setPowerModeTab,
  subscribePowerMode,
  type PowerProfile,
} from './lib/powerMode';
import {
  appendTrailPoint,
  getActiveTrack,
  mergeIncomingTracks,
  TRAIL_CLOUD_SYNC_MS,
  TRAIL_PERSIST_MS,
} from './lib/gpsTrail';
import { Navigation } from './components/Navigation';
import { WaypointsManager } from './components/WaypointsManager';
import { JournalAndPhotos } from './components/JournalAndPhotos';
import { TricountBudget } from './components/TricountBudget';
import { ProfileSettings } from './components/ProfileSettings';
import { VanSleepSearch } from './components/VanSleepSearch';
import { AuthModal } from './components/AuthModal';
import { calculateHaversineDistance } from './services/gpx';
import { startGeolocationWatch, type GeoStatus } from './services/geolocation';
import { toUserFacingError, isAuthExpiryError } from './lib/userFacingError';
import {
  hydrateFriendAvatars,
  resolveFriendAvatar,
  writeCrewCustomization,
  type CrewCustomization,
} from './lib/crewAvatars';
import { normalizeBundleFriendIds } from './lib/legacyIds';
import { normalizeExpensesForFriends } from './lib/expenseSplit';
import {
  CREW_MEMBER_NAMES,
  ensureCrewSession,
  keepCrewSessionAlive,
  getStoredCrewUserMap,
  isCrewMemberName,
  resolveCrewNameByUserId,
  resolvePreferredCrewName,
  saveCrewUserId,
  switchToCrewMember,
  type CrewMemberName,
} from './services/supabase';

const MapView = lazy(() =>
  import('./components/MapView').then((module) => ({ default: module.MapView }))
);
const ACTIVE_TAB_KEY = 'van_active_tab_v1';
const CREW_CUSTOMIZATIONS_KEY = 'van_crew_customizations_v1';
/** Voyage équipage reconstruit — Adel / Paul / Yanis (éditeurs). */
const SHARED_CREW_INVITE = 'ACF77E77';
const VALID_TABS: TabType[] = ['map', 'sleep', 'waypoints', 'journal', 'budget', 'profile'];

function readCrewCustomizations(): Record<string, CrewCustomization> {
  try {
    const stored = JSON.parse(localStorage.getItem(CREW_CUSTOMIZATIONS_KEY) || '{}');
    return stored && typeof stored === 'object' ? stored : {};
  } catch {
    return {};
  }
}

function readStoredTab(): TabType {
  try {
    const stored = localStorage.getItem(ACTIVE_TAB_KEY) as TabType | null;
    if (stored && VALID_TABS.includes(stored)) return stored;
  } catch {
    // ignore
  }
  return 'map';
}

export default function App() {
  const mainRef = useRef<HTMLElement>(null);
  const [activeTab, setActiveTabState] = useState<TabType>(() => readStoredTab());
  const [mapMounted, setMapMounted] = useState(() => readStoredTab() === 'map');

  useEffect(() => {
    if (activeTab === 'map') setMapMounted(true);
  }, [activeTab]);

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
    setPowerModeTab(tab);
    mainRef.current?.scrollTo(0, 0);
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, tab);
    } catch {
      // ignore
    }
  };
  const [friends, setFriends] = useState<Friend[]>([]);
  const [currentFriendId, setCurrentFriendId] = useState<string>('adel');
  const [pois, setPois] = useState<Poi[]>([]);
  const [journal, setJournal] = useState<JournalNote[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [photos, setPhotos] = useState<TripPhoto[]>([]);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [tracks, setTracks] = useState<GpsTrack[]>([]);
  const [mapFocus, setMapFocus] = useState<{
    lat: number;
    lng: number;
    requestId: number;
    label?: string;
    emoji?: string;
  } | null>(null);
  const [sleepSearchSpots, setSleepSearchSpots] = useState<VanSleepSpot[]>([]);

  const [userLocation, setUserLocation] = useState<GpsPoint | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [activeTripId, setActiveTripIdState] = useState<string | null>(null);
  const [syncError, setSyncError] = useState('');
  const [booting, setBooting] = useState(true);
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const cloudRef = useRef<CloudContext | null>(null);
  const schemaCheckedRef = useRef(false);
  const tracksLoadedRef = useRef(false);
  const tracksRef = useRef<GpsTrack[]>([]);
  const trailPersistAtRef = useRef(0);
  const trailCloudAtRef = useRef(0);
  const trailSyncedCountRef = useRef<Record<string, number>>({});
  const trailCloudCreatedRef = useRef<Set<string>>(new Set());
  const lastLivePushRef = useRef(0);
  const lastLiveCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const userLocationRef = useRef<GpsPoint | null>(null);
  const currentFriendIdRef = useRef(currentFriendId);
  const crewCustomizationsRef = useRef<Record<string, CrewCustomization>>(readCrewCustomizations());
  const crewAccountNamesRef = useRef<Record<string, (typeof CREW_MEMBER_NAMES)[number]>>({});
  const [geoStatus, setGeoStatus] = useState<GeoStatus>({ state: 'idle' });
  const [powerProfile, setPowerProfile] = useState<PowerProfile>(() =>
    getPowerProfile({ documentVisible: isDocumentVisible(), activeTab: readStoredTab() })
  );
  const powerProfileRef = useRef(powerProfile);
  const lastUiLocationUpdateRef = useRef(0);

  useEffect(() => {
    powerProfileRef.current = powerProfile;
  }, [powerProfile]);

  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  const persistTracksSoon = (nextTracks: GpsTrack[], force = false) => {
    const now = Date.now();
    if (!force && now - trailPersistAtRef.current < TRAIL_PERSIST_MS) return;
    trailPersistAtRef.current = now;
    void dbService.saveTracks(nextTracks);
  };

  const syncTrailToCloud = (track: GpsTrack, force = false) => {
    const ctx = cloudRef.current;
    if (!ctx || !track.points.length) return;
    const now = Date.now();
    if (!force && now - trailCloudAtRef.current < TRAIL_CLOUD_SYNC_MS) return;
    if (!force) trailCloudAtRef.current = now;

    void (async () => {
      try {
        if (!trailCloudCreatedRef.current.has(track.id)) {
          await insertTrack(ctx, {
            ...track,
            endTime: track.isActive ? undefined : track.endTime,
          });
          trailCloudCreatedRef.current.add(track.id);
          trailSyncedCountRef.current[track.id] = track.points.length;
          return;
        }

        const already = trailSyncedCountRef.current[track.id] ?? 0;
        const fresh = track.points.slice(already);
        if (fresh.length) {
          await insertTrackPoints(ctx, track.id, fresh);
          trailSyncedCountRef.current[track.id] = track.points.length;
        }
        await updateTrackStats(ctx, track.id, {
          distanceKm: track.distanceKm,
          avgSpeedKmH: track.avgSpeedKmH,
          maxSpeedKmH: track.maxSpeedKmH,
          endTime: track.isActive ? null : track.endTime ?? null,
          title: track.title,
        });
      } catch (err) {
        console.warn('Trail cloud sync failed', err);
      }
    })();
  };

  const recordTrailPointRef = useRef<(point: GpsPoint, accuracyM?: number) => void>(() => {});
  recordTrailPointRef.current = (point: GpsPoint, accuracyM?: number) => {
    const friendId = cloudRef.current?.user.id ?? currentFriendIdRef.current;
    const before = tracksRef.current;
    const next = appendTrailPoint(before, point, friendId, { accuracyM });
    if (!next) return;
    tracksRef.current = next;
    setTracks(next);
    persistTracksSoon(next);

    // Day rollover: finalize the closed track in the cloud, then sync the new active one.
    const closed = next.filter(
      (track) => !track.isActive && before.some((prev) => prev.id === track.id && prev.isActive)
    );
    for (const track of closed) {
      syncTrailToCloud(track, true);
    }

    const active = getActiveTrack(next);
    if (active) syncTrailToCloud(active);
  };

  useEffect(() => {
    const flush = () => {
      persistTracksSoon(tracksRef.current, true);
      for (const track of tracksRef.current) {
        if (!track.points?.length) continue;
        syncTrailToCloud(track, true);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  useEffect(() => {
    setPowerModeTab(activeTab);
    return subscribePowerMode(setPowerProfile);
  }, [activeTab]);

  useEffect(() => {
    currentFriendIdRef.current = currentFriendId;
  }, [currentFriendId]);

  useEffect(() => {
    const syncUiFromRef = () => {
      if (document.visibilityState !== 'visible') return;
      const point = userLocationRef.current;
      if (!point) return;
      setUserLocation(point);
      lastUiLocationUpdateRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', syncUiFromRef);
    return () => document.removeEventListener('visibilitychange', syncUiFromRef);
  }, []);

  const mirrorLocal = async (bundle: {
    friends?: Friend[];
    pois?: Poi[];
    journal?: JournalNote[];
    expenses?: Expense[];
    photos?: TripPhoto[];
    waypoints?: Waypoint[];
    tracks?: GpsTrack[];
    currentFriendId?: string;
  }) => {
    if (bundle.friends) await dbService.saveFriends(bundle.friends);
    if (bundle.pois) await dbService.savePois(bundle.pois);
    if (bundle.journal) await dbService.saveJournal(bundle.journal);
    if (bundle.expenses) await dbService.saveExpenses(bundle.expenses);
    if (bundle.photos) await dbService.savePhotos(bundle.photos);
    if (bundle.waypoints) await dbService.saveWaypoints(bundle.waypoints);
    if (bundle.tracks) await dbService.saveTracks(bundle.tracks);
    if (bundle.currentFriendId) await dbService.saveCurrentFriendId(bundle.currentFriendId);
  };

  const applyBundle = async (
    bundle: Awaited<ReturnType<typeof loadTripBundle>>,
    userId: string
  ) => {
    const storedCrewIds = getStoredCrewUserMap();
    const crewFriends = CREW_MEMBER_NAMES.flatMap((name) => {
      const mappedId = storedCrewIds[name];
      const friend =
        (mappedId ? bundle.friends.find((candidate) => candidate.id === mappedId) : undefined) ??
        bundle.friends.find(
          (candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase()
        );
      if (!friend) return [];
      saveCrewUserId(name, friend.id);
      crewAccountNamesRef.current[friend.id] = name;
      // Cloud is authoritative for display name + avatar when connected.
      return [{
        ...friend,
        name: friend.name,
        avatar: resolveFriendAvatar(friend.name, friend.color, friend.avatar),
      }];
    });
    const visibleFriends = crewFriends.length ? crewFriends : bundle.friends;
    const remapped = normalizeBundleFriendIds(bundle, visibleFriends, getStoredCrewUserMap());
    const normalizedExpenses = normalizeExpensesForFriends(remapped.expenses, visibleFriends);
    const selectedFriendId = visibleFriends.some(
      (friend) => friend.id === currentFriendIdRef.current
    )
      ? currentFriendIdRef.current
      : visibleFriends.find((friend) => friend.id === userId)?.id ?? visibleFriends[0]?.id ?? userId;

    setFriends(visibleFriends);
    setPois(remapped.pois);
    setJournal(remapped.journal);
    setExpenses(normalizedExpenses);
    setPhotos(remapped.photos);
    setWaypoints(remapped.waypoints);
    const mergedTracks = mergeIncomingTracks(remapped.tracks, tracksRef.current);
    tracksRef.current = mergedTracks;
    setTracks(mergedTracks);
    for (const track of mergedTracks) {
      if ((track.points?.length ?? 0) > 0 && !track.isActive) {
        trailCloudCreatedRef.current.add(track.id);
        trailSyncedCountRef.current[track.id] = Math.max(
          trailSyncedCountRef.current[track.id] ?? 0,
          track.points.length
        );
      }
    }
    currentFriendIdRef.current = selectedFriendId;
    setCurrentFriendId(selectedFriendId);
    void mirrorLocal({
      ...remapped,
      tracks: mergedTracks,
      expenses: normalizedExpenses,
      friends: visibleFriends,
      currentFriendId: selectedFriendId,
    });
  };

  const loadLocalCache = async () => {
    const rawFriends = await dbService.getFriends();
    const f = hydrateFriendAvatars(rawFriends);
    const p = await dbService.getPois();
    const j = await dbService.getJournal();
    const e = await dbService.getExpenses();
    const ph = await dbService.getPhotos();
    const w = await dbService.getWaypoints();
    const t = await dbService.getTracks();
    const currF = await dbService.getCurrentFriendId();

    setFriends(f);
    setPois(p);
    setJournal(j);
    setExpenses(e);
    setPhotos(ph);
    setWaypoints(w);
    tracksRef.current = t;
    setTracks(t);
    const initialFriendId = currF || f[0]?.id || 'adel';
    currentFriendIdRef.current = initialFriendId;
    setCurrentFriendId(initialFriendId);
  };

  const refreshFromCloud = async (
    ctx: CloudContext,
    options?: LoadTripBundleOptions & { persist?: boolean }
  ) => {
    const bundle = await loadTripBundle(ctx, options);
    await applyBundle(bundle, ctx.user.id);
    if (options?.includeTrackPoints) tracksLoadedRef.current = true;
    return bundle;
  };

  const pushLocalToCloud = async (ctx: CloudContext) => {
    const local = {
      pois: await dbService.getPois(),
      waypoints: await dbService.getWaypoints(),
      journal: await dbService.getJournal(),
      photos: await dbService.getPhotos(),
      expenses: await dbService.getExpenses(),
      tracks: tracksRef.current.length ? tracksRef.current : await dbService.getTracks(),
    };
    const merged = await syncLocalDataToCloud(ctx, local);
    await applyBundle(merged, ctx.user.id);
    tracksLoadedRef.current = true;
    return merged;
  };

  /** Always keep a live cloud context — silent re-login, no auth modal spam. */
  const ensureCloudCtx = async (): Promise<CloudContext | null> => {
    if (!isCloudConfigured()) return null;
    if (cloudRef.current) {
      void keepCrewSessionAlive();
      return cloudRef.current;
    }
    await keepCrewSessionAlive();
    const ok = await connectCloud({
      migrateLocal: false,
      skipCrewBootstrap: true,
      skipSessionEnsure: true,
    });
    return ok ? cloudRef.current : null;
  };

  const withCloud = async <T,>(
    action: (ctx: CloudContext) => Promise<T>,
    fallbackMsg: string
  ): Promise<T> => {
    const ctx = await ensureCloudCtx();
    if (!ctx) throw new Error(fallbackMsg);
    try {
      return await action(ctx);
    } catch (err) {
      if (!isAuthExpiryError(err)) throw err;
      await keepCrewSessionAlive();
      const ok = await connectCloud({
        migrateLocal: false,
        skipCrewBootstrap: true,
        skipSessionEnsure: true,
      });
      const fresh = ok ? cloudRef.current : null;
      if (!fresh) throw err;
      return await action(fresh);
    }
  };

  const connectCloud = async (options?: {
    cloudOnly?: boolean;
    migrateLocal?: boolean;
    skipCrewBootstrap?: boolean;
    skipSessionEnsure?: boolean;
    fastOnly?: boolean;
  }) => {
    setSyncError('');
    if (!isCloudConfigured()) {
      cloudRef.current = null;
      setCloudReady(false);
      return false;
    }

    setCloudSyncing(true);
    try {
      if (!options?.skipSessionEnsure) {
        await ensureCrewSession(resolvePreferredCrewName());
      } else {
        await keepCrewSessionAlive();
      }

      let ctx = await bootstrapCloud();
      if (!ctx) {
        await keepCrewSessionAlive();
        ctx = await bootstrapCloud();
      }
      if (!ctx) {
        cloudRef.current = null;
        setCloudReady(false);
        // Stay silent: crew accounts auto-reconnect; avoid auth-modal spam.
        return false;
      }

      try {
        ctx = await ensureSharedCrewTrip(ctx, {
          skipCrewBootstrap: options?.skipCrewBootstrap ?? options?.cloudOnly,
        });
      } catch (crewErr) {
        console.warn('Crew trip sync failed', crewErr);
        setSyncError(toUserFacingError(crewErr, 'Impossible de rejoindre le voyage partagé.'));
        throw crewErr;
      }

      cloudRef.current = ctx;
      setActiveTripIdState(ctx.tripId);

      if (!schemaCheckedRef.current) {
        schemaCheckedRef.current = true;
        const schemaIssues = await verifyCloudSchema(ctx);
        if (schemaIssues.length) {
          console.warn('Schéma Supabase incomplet:', schemaIssues.join(', '));
          setSyncError(
            `Schéma cloud incomplet — lance ensure_full_sync.sql : ${schemaIssues.join(' · ')}`
          );
        }
      }

      await refreshFromCloud(ctx, { includeTrackPoints: false });

      if (!options?.fastOnly) {
        void refreshFromCloud(ctx, { includeTrackPoints: true }).catch((err) => {
          console.warn('Deferred track load failed', err);
        });
      }

      if (options?.migrateLocal && !options?.cloudOnly) {
        try {
          await pushLocalToCloud(ctx);
        } catch (pushErr) {
          console.warn('Push local → cloud failed', pushErr);
        }
      }

      setCloudReady(true);
      setIsAuthModalOpen(false);
      return true;
    } catch (err: any) {
      console.error('Cloud sync failed', err);
      // Auth blips: silent retry once, never spam "session expirée".
      if (isAuthExpiryError(err)) {
        try {
          await keepCrewSessionAlive();
          const retry = await bootstrapCloud();
          if (retry) {
            cloudRef.current = retry;
            setActiveTripIdState(retry.tripId);
            await refreshFromCloud(retry, { includeTrackPoints: false });
            setCloudReady(true);
            setSyncError('');
            return true;
          }
        } catch (retryErr) {
          console.warn('Silent reconnect failed', retryErr);
        }
        setSyncError('');
      } else {
        setSyncError(toUserFacingError(err, 'Synchronisation indisponible.'));
      }
      cloudRef.current = null;
      setCloudReady(false);
      return false;
    } finally {
      setCloudSyncing(false);
    }
  };

  useEffect(() => {
    async function init() {
      // One-shot local wipe after shared crew invite migration — never clear every boot.
      const RESET_STAMP = 'crew_clean_acf77e77_v2';
      const alreadyReset = localStorage.getItem('van_db_reset_stamp_v1') === RESET_STAMP;
      saveCrewInviteCode(SHARED_CREW_INVITE);

      if (!alreadyReset) {
        try {
          localStorage.removeItem(CREW_CUSTOMIZATIONS_KEY);
          localStorage.removeItem('van_current_trip_id_v1');
          crewCustomizationsRef.current = {};
        } catch {
          // ignore
        }
        await dbService.clearAllLocalTripData();
        localStorage.setItem('van_db_reset_stamp_v1', RESET_STAMP);
      } else {
        crewCustomizationsRef.current = readCrewCustomizations();
      }

      await loadLocalCache();
      setBooting(false);

      if (isCloudConfigured()) {
        void connectCloud({ migrateLocal: true }).then((ok) => {
          if (ok && cloudRef.current) {
            void migrateProfileAvatarsToStorage(cloudRef.current);
          }
        });
      }
    }
    void init();
  }, []);

  // Keep the crew JWT alive in the background — no auth prompts.
  useEffect(() => {
    if (!isCloudConfigured()) return;
    const tick = () => {
      void keepCrewSessionAlive().then((user) => {
        if (user && !cloudRef.current) {
          void connectCloud({
            migrateLocal: false,
            skipCrewBootstrap: true,
            skipSessionEnsure: true,
          });
        }
      });
    };
    tick();
    const id = window.setInterval(tick, 4 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const ctx = cloudRef.current;
    if (!cloudReady || !ctx) return;

    let refreshTimer: number | undefined;
    let refreshing = false;
    let pendingRefresh: { tracks?: boolean; showSpinner?: boolean } | null = null;

    const refreshTripBundle = async (opts?: { tracks?: boolean; showSpinner?: boolean }) => {
      if (refreshing) {
        pendingRefresh = {
          tracks: Boolean(pendingRefresh?.tracks || opts?.tracks),
          showSpinner: Boolean(pendingRefresh?.showSpinner || opts?.showSpinner),
        };
        return;
      }
      refreshing = true;
      if (opts?.showSpinner) setCloudSyncing(true);
      try {
        // Never pull GPS track points on background refresh — too slow.
        await refreshFromCloud(ctx, { includeTrackPoints: Boolean(opts?.tracks) });
      } catch (err) {
        console.warn('Trip refresh failed', err);
      } finally {
        refreshing = false;
        if (opts?.showSpinner) setCloudSyncing(false);
        if (pendingRefresh) {
          const next = pendingRefresh;
          pendingRefresh = null;
          void refreshTripBundle(next);
        }
      }
    };

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshTripBundle({ tracks: false, showSpinner: false });
      }, SYNC_DEBOUNCE_MS);
    };

    const patchFriendLocation = (
      userId: string,
      next: { lat?: number; lng?: number; battery?: number | null; updated_at?: string } | null
    ) => {
      setFriends((prev) => {
        const updated = prev.map((friend) => {
          if (friend.id !== userId) return friend;
          if (!next || next.lat == null || next.lng == null || Number.isNaN(next.lat)) {
            return {
              ...friend,
              liveLat: undefined,
              liveLng: undefined,
              lastActive: 'Hors ligne',
              lastActiveAt: undefined,
            };
          }

          // Keep fresher local GPS for the current device.
          if (friend.id === ctx.user.id && userLocationRef.current) {
            const localTs = userLocationRef.current.timestamp;
            const remoteTs = next.updated_at ? new Date(next.updated_at).getTime() : 0;
            if (localTs >= remoteTs - 1500) {
              return {
                ...friend,
                liveLat: userLocationRef.current.lat,
                liveLng: userLocationRef.current.lng,
                lastActiveAt: localTs,
                lastActive: formatLastActive(localTs),
              };
            }
          }

          const lastActiveAt = next.updated_at ? new Date(next.updated_at).getTime() : Date.now();
          return {
            ...friend,
            liveLat: next.lat,
            liveLng: next.lng,
            battery: next.battery ?? friend.battery,
            lastActiveAt,
            lastActive: formatLastActive(lastActiveAt),
          };
        });
        if (isDocumentVisible()) {
          void dbService.saveFriends(updated);
        }
        return updated;
      });
    };

    const unsubscribe = subscribeTripRealtime(ctx, {
      onDataChange: scheduleRefresh,
      onLocationChange: (row, eventType) => {
        if (!row?.user_id) {
          scheduleRefresh();
          return;
        }
        if (eventType === 'DELETE') {
          patchFriendLocation(row.user_id, null);
          return;
        }
        patchFriendLocation(row.user_id, row);
      },
    });

    const pollLocations = window.setInterval(() => {
      if (!powerProfileRef.current.syncLocationsWhenHidden && !isDocumentVisible()) return;
      void fetchLiveLocations(ctx)
        .then((rows) => {
          setFriends((prev) => {
            const updated = mergeLiveLocationsIntoFriends(prev, rows).map((friend) => {
              if (friend.id !== ctx.user.id || !userLocationRef.current) return friend;
              return {
                ...friend,
                liveLat: userLocationRef.current.lat,
                liveLng: userLocationRef.current.lng,
                lastActiveAt: userLocationRef.current.timestamp,
                lastActive: formatLastActive(userLocationRef.current.timestamp),
              };
            });
            if (isDocumentVisible()) {
              void dbService.saveFriends(updated);
            }
            return updated;
          });
        })
        .catch((err) => console.warn('Live location poll failed', err));
    }, powerProfile.liveLocationPollMs);

    const fullSyncInterval = window.setInterval(() => {
      void refreshTripBundle({ tracks: false, showSpinner: false });
    }, powerProfile.fullSyncMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const onWindowFocus = () => scheduleRefresh();
    const onOnline = () => scheduleRefresh();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('online', onOnline);

    const tickActiveLabels =
      powerProfile.activeLabelTickMs > 0
        ? window.setInterval(() => {
            setFriends((prev) =>
              prev.map((friend) =>
                friend.lastActiveAt
                  ? { ...friend, lastActive: formatLastActive(friend.lastActiveAt) }
                  : friend
              )
            );
          }, powerProfile.activeLabelTickMs)
        : undefined;

    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(pollLocations);
      window.clearInterval(fullSyncInterval);
      if (tickActiveLabels != null) window.clearInterval(tickActiveLabels);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('online', onOnline);
      unsubscribe();
    };
  }, [cloudReady, activeTripId, powerProfile]);

  useEffect(() => {
    const profile = powerProfile;
    const stop = startGeolocationWatch(
      {
      onStatus: (status) => {
        setGeoStatus(status);
        if (status.state === 'error' && status.fatal) {
          userLocationRef.current = null;
          setUserLocation(null);
        }
      },
      onPosition: (position) => {
        const { latitude, longitude, altitude, speed, accuracy } = position.coords;
        const now = position.timestamp || Date.now();

        const altMeters =
          altitude != null && Number.isFinite(altitude) ? Math.round(altitude) : undefined;
        const speedKmh =
          speed != null && Number.isFinite(speed) && speed >= 0
            ? Math.round(speed * 3.6 * 10) / 10
            : undefined;

        const newPoint: GpsPoint = {
          lat: latitude,
          lng: longitude,
          altitude: altMeters,
          speed: speedKmh,
          timestamp: now,
        };

        userLocationRef.current = newPoint;
        recordTrailPointRef.current(
          newPoint,
          accuracy != null && Number.isFinite(accuracy) ? accuracy : undefined
        );

        const power = powerProfileRef.current;
        const shouldUpdateUi =
          power.uiLocationUpdateMs === 0
            ? isDocumentVisible()
            : now - lastUiLocationUpdateRef.current >= power.uiLocationUpdateMs;

        if (shouldUpdateUi) {
          lastUiLocationUpdateRef.current = now;
          setUserLocation(newPoint);

          const myId = cloudRef.current?.user.id ?? currentFriendIdRef.current;
          setFriends((prevFriends) => {
            const updated = prevFriends.map((f) =>
              f.id === myId
                ? {
                    ...f,
                    liveLat: latitude,
                    liveLng: longitude,
                    lastActiveAt: now,
                    lastActive: "À l'instant",
                  }
                : f
            );
            if (isDocumentVisible()) {
              void dbService.saveFriends(updated);
            }
            return updated;
          });
        }

        const ctx = cloudRef.current;
        if (ctx) {
          const prev = lastLiveCoordsRef.current;
          const movedMeters = prev
            ? calculateHaversineDistance(prev.lat, prev.lng, latitude, longitude) * 1000
            : Number.POSITIVE_INFINITY;
          const dueByTime = now - lastLivePushRef.current > power.liveLocationPushMs;
          const dueByMove = movedMeters > power.liveLocationMoveM;
          if (dueByTime || dueByMove) {
            lastLivePushRef.current = now;
            lastLiveCoordsRef.current = { lat: latitude, lng: longitude };
            void upsertLiveLocation(ctx, {
              lat: latitude,
              lng: longitude,
              altitude: altMeters,
            }).catch((err) => console.warn('Live location sync failed', err));
          }
        }
      },
    },
      {
        highAccuracy: profile.geoHighAccuracy,
        maximumAgeMs: profile.geoMaximumAgeMs,
        minEmitIntervalMs: profile.geoMinEmitIntervalMs,
        timeoutMs: profile.geoTimeoutMs,
      }
    );

    return stop;
  }, [powerProfile]);

  useEffect(() => {
    const ctx = cloudRef.current;
    if (!cloudReady || !ctx || activeTab !== 'map' || tracksLoadedRef.current) return;
    void refreshFromCloud(ctx, { includeTrackPoints: true }).catch((err) => {
      console.warn('Map track load failed', err);
    });
  }, [activeTab, cloudReady]);

  const handleManualRefresh = () => {
    const ctx = cloudRef.current;
    if (!ctx) {
      void connectCloud({ migrateLocal: true });
      return;
    }
    setCloudSyncing(true);
    void (async () => {
      try {
        await pushLocalToCloud(ctx);
      } catch (err) {
        console.warn('Push local → cloud failed', err);
        await refreshFromCloud(ctx, { includeTrackPoints: tracksLoadedRef.current }).catch((pullErr) =>
          console.warn('Manual refresh failed', pullErr)
        );
      }
    })().finally(() => setCloudSyncing(false));
  };

  const resolveCrewAccountName = (friend: Friend): CrewMemberName | undefined => {
    const fromRef = crewAccountNamesRef.current[friend.id];
    if (fromRef) return fromRef;
    const fromMap = resolveCrewNameByUserId(friend.id);
    if (fromMap) return fromMap;
    if (isCrewMemberName(friend.name)) return friend.name;
    return undefined;
  };

  const handleSwitchToCrewMember = (name: CrewMemberName) => {
    const storedId = getStoredCrewUserMap()[name];
    const friend =
      (storedId ? friends.find((candidate) => candidate.id === storedId) : undefined) ??
      friends.find((candidate) => crewAccountNamesRef.current[candidate.id] === name) ??
      friends.find((candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase());
    if (friend) void handleCurrentFriendChange(friend.id);
    else void switchToCrewMember(name).then(() =>
      connectCloud({ cloudOnly: true, skipCrewBootstrap: true, skipSessionEnsure: true })
    );
  };

  const handleUpdateOwnProfile = async (patch: { name: string; avatar: string }) => {
    const friendId = currentFriendIdRef.current;
    const friend = friends.find((candidate) => candidate.id === friendId);
    if (!friend) return;

    const crewName = crewAccountNamesRef.current[friendId] as CrewMemberName | undefined;

    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        throw new Error('Cloud indisponible. Réessaie dans un instant.');
      }
      if (ctx.user.id !== friendId) {
        throw new Error('Bascule sur ce profil pour modifier ses informations.');
      }

      setSavingProfile(true);
      setSyncError('');
      try {
        const savedAvatar = await updateOwnProfile(ctx, {
          name: patch.name,
          avatar: patch.avatar,
        });
        const finalAvatar = savedAvatar || patch.avatar;
        // Never put data:/blob: into JWT metadata — blows up token size → Storage 400 + sync lente.
        const metaAvatar =
          finalAvatar && (finalAvatar.startsWith('http://') || finalAvatar.startsWith('https://'))
            ? finalAvatar
            : '';
        const { error: metaError } = await ctx.supabase.auth.updateUser({
          data: { name: patch.name, avatar_url: metaAvatar },
        });
        if (metaError) throw metaError;

        const synced = friends.map((candidate) =>
          candidate.id === friendId
            ? { ...candidate, name: patch.name, avatar: finalAvatar }
            : candidate
        );
        setFriends(synced);
        await dbService.saveFriends(synced);

        // Local mirror only — cloud remains source of truth after refresh.
        crewCustomizationsRef.current = writeCrewCustomization(
          crewCustomizationsRef.current,
          friendId,
          crewName,
          { name: patch.name, avatar: finalAvatar }
        );
        localStorage.setItem(CREW_CUSTOMIZATIONS_KEY, JSON.stringify(crewCustomizationsRef.current));

        await refreshFromCloud(ctx, { includeTrackPoints: false });
      } catch (err) {
        setSyncError(toUserFacingError(err, 'Impossible d’enregistrer le profil.'));
        throw err instanceof Error ? err : new Error('Impossible d’enregistrer le profil.');
      } finally {
        setSavingProfile(false);
      }
      return;
    }

    // Offline / unconfigured: device-local only.
    crewCustomizationsRef.current = writeCrewCustomization(
      crewCustomizationsRef.current,
      friendId,
      crewName,
      patch
    );
    localStorage.setItem(CREW_CUSTOMIZATIONS_KEY, JSON.stringify(crewCustomizationsRef.current));
    const updatedFriends = friends.map((candidate) =>
      candidate.id === friendId
        ? { ...candidate, name: patch.name, avatar: patch.avatar }
        : candidate
    );
    setFriends(updatedFriends);
    await dbService.saveFriends(updatedFriends);
  };

  const profileFriend = friends.find((friend) => friend.id === currentFriendId) || friends[0];
  const activeAuthorId = (cloudReady && cloudRef.current?.user.id) || currentFriendId;
  const activeCrewName = profileFriend
    ? (crewAccountNamesRef.current[profileFriend.id] ||
        (isCrewMemberName(profileFriend.name) ? profileFriend.name : undefined))
    : undefined;

  const handleCurrentFriendChange = async (id: string) => {
    if (!friends.some((friend) => friend.id === id)) return;

    const ctx = cloudRef.current;
    const friend = friends.find((candidate) => candidate.id === id);
    if (!friend) return;

    const crewAccountName = resolveCrewAccountName(friend);
    const needsAuthSwitch = Boolean(ctx && crewAccountName && id !== ctx.user.id);

    if (needsAuthSwitch && crewAccountName) {
      setCloudSyncing(true);
      setSyncError('');
      try {
        const user = await switchToCrewMember(crewAccountName);
        currentFriendIdRef.current = user.id;
        setCurrentFriendId(user.id);
        await dbService.saveCurrentFriendId(user.id);

        let ctx = await bootstrapCloud();
        if (!ctx) {
          await keepCrewSessionAlive();
          ctx = await bootstrapCloud();
        }
        if (!ctx) throw new Error('Cloud indisponible. Réessaie dans un instant.');
        ctx = await ensureSharedCrewTrip(ctx, { skipCrewBootstrap: true });
        cloudRef.current = ctx;
        setActiveTripIdState(ctx.tripId);
        setCloudReady(true);

        await refreshFromCloud(ctx, { includeTrackPoints: false });
        void refreshFromCloud(ctx, { includeTrackPoints: true }).catch((err) => {
          console.warn('Deferred track load failed', err);
        });
      } catch (err) {
        setSyncError(toUserFacingError(err, `Impossible de passer sur le profil ${friend.name}.`));
      } finally {
        setCloudSyncing(false);
      }
      return;
    }

    currentFriendIdRef.current = id;
    setCurrentFriendId(id);
    void dbService.saveCurrentFriendId(id);

    if (ctx && isCloudConfigured()) {
      setCloudSyncing(true);
      void refreshFromCloud(ctx, { includeTrackPoints: tracksLoadedRef.current }).finally(() => {
        setCloudSyncing(false);
      });
    }
  };

  const handleAddPoi = async (newPoiData: Omit<Poi, 'id' | 'createdAt'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudInsertPoi(ctx, newPoiData);
        const updated = [saved, ...pois];
        setPois(updated);
        await dbService.savePois(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible d’ajouter ce spot.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const newPoi: Poi = {
      ...newPoiData,
      id: 'poi_' + Date.now(),
      createdAt: new Date().toISOString(),
    };
    const updated = [newPoi, ...pois];
    setPois(updated);
    await dbService.savePois(updated);
  };

  const handleDeletePoi = async (id: string) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudDeletePoi(ctx, id);
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de supprimer le spot.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = pois.filter((poi) => poi.id !== id);
    setPois(updated);
    await dbService.savePois(updated);
  };

  const handleUpdatePoi = async (id: string, data: Omit<Poi, 'id' | 'createdAt'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudUpdatePoi(ctx, id, data);
        const updated = pois.map((poi) => (poi.id === id ? saved : poi));
        setPois(updated);
        await dbService.savePois(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de modifier le spot.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = pois.map((poi) =>
      poi.id === id ? { ...poi, ...data } : poi
    );
    setPois(updated);
    await dbService.savePois(updated);
  };

  const handleAddJournalNote = async (newNoteData: Omit<JournalNote, 'id'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudInsertJournalNote(ctx, newNoteData);
        const updated = [saved, ...journal];
        setJournal(updated);
        await dbService.saveJournal(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible d’enregistrer la note.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const newNote: JournalNote = { ...newNoteData, id: 'note_' + Date.now() };
    const updated = [newNote, ...journal];
    setJournal(updated);
    await dbService.saveJournal(updated);
  };

  const handleDeleteJournalNote = async (id: string) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudDeleteJournalNote(ctx, id);
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de supprimer la note.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = journal.filter((note) => note.id !== id);
    setJournal(updated);
    await dbService.saveJournal(updated);
  };

  const handleUpdateJournalNote = async (id: string, data: Omit<JournalNote, 'id'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudUpdateJournalNote(ctx, id, data);
        const updated = journal.map((note) => (note.id === id ? saved : note));
        setJournal(updated);
        await dbService.saveJournal(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de modifier la note.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = journal.map((note) => (note.id === id ? { ...data, id } : note));
    setJournal(updated);
    await dbService.saveJournal(updated);
  };

  const handleAddPhoto = async (newPhotoData: Omit<TripPhoto, 'id'>) => {
    const isVideo = newPhotoData.mediaType === 'video';
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.';
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudInsertPhoto(ctx, newPhotoData);
        const updated = [saved, ...photos];
        setPhotos(updated);
        await dbService.savePhotos(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(
          err,
          isVideo ? 'Impossible d’ajouter la vidéo.' : 'Impossible d’ajouter la photo.'
        );
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const newPhoto: TripPhoto = { ...newPhotoData, id: 'photo_' + Date.now() };
    const updated = [newPhoto, ...photos];
    setPhotos(updated);
    await dbService.savePhotos(updated);
  };

  const handleDeletePhoto = async (id: string) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudDeletePhoto(ctx, id);
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de supprimer la photo.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = photos.filter((photo) => photo.id !== id);
    setPhotos(updated);
    await dbService.savePhotos(updated);
  };

  const handleAddExpense = async (newExpData: Omit<Expense, 'id'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudInsertExpense(ctx, newExpData);
        setExpenses((prev) => {
          const next = [saved, ...prev.filter((expense) => expense.id !== saved.id)];
          void dbService.saveExpenses(next);
          return next;
        });
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible d’ajouter la dépense.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const newExp: Expense = { ...newExpData, id: 'exp_' + Date.now() };
    setExpenses((prev) => {
      const next = [newExp, ...prev];
      void dbService.saveExpenses(next);
      return next;
    });
  };

  const handleUpdateExpense = async (id: string, data: Omit<Expense, 'id'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      if (id.startsWith('exp_')) {
        const msg = 'Cette dépense locale n’est pas encore synchronisée.';
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudUpdateExpense(ctx, id, data);
        setExpenses((prev) => {
          const next = prev.map((expense) => (expense.id === id ? saved : expense));
          void dbService.saveExpenses(next);
          return next;
        });
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de modifier la dépense.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    setExpenses((prev) => {
      const next = prev.map((expense) => (expense.id === id ? { ...data, id } : expense));
      void dbService.saveExpenses(next);
      return next;
    });
  };

  const handleDeleteExpense = async (id: string) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudDeleteExpense(ctx, id);
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de supprimer la dépense.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    setExpenses((prev) => {
      const next = prev.filter((e) => e.id !== id);
      void dbService.saveExpenses(next);
      return next;
    });
  };

  const handleClearAllExpenses = async () => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudDeleteAllExpenses(ctx);
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de réinitialiser les dépenses.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    setExpenses([]);
    await dbService.saveExpenses([]);
  };

  const handleAddWaypoint = async (newWpData: Omit<Waypoint, 'id'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudInsertWaypoint(ctx, newWpData);
        const updated = [...waypoints, saved];
        setWaypoints(updated);
        await dbService.saveWaypoints(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible d’ajouter l’étape.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const newWp: Waypoint = { ...newWpData, id: 'wp_' + Date.now() };
    const updated = [...waypoints, newWp];
    setWaypoints(updated);
    await dbService.saveWaypoints(updated);
  };

  const handleUpdateWaypoint = async (id: string, data: Omit<Waypoint, 'id'>) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        const saved = await cloudUpdateWaypoint(ctx, id, data);
        const updated = waypoints.map((wp) => (wp.id === id ? saved : wp));
        setWaypoints(updated);
        await dbService.saveWaypoints(updated);
        return;
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de modifier l’étape.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = waypoints.map((wp) => (wp.id === id ? { ...data, id } : wp));
    setWaypoints(updated);
    await dbService.saveWaypoints(updated);
  };

  const handleUpdateWaypointStatus = async (id: string, status: 'done' | 'active' | 'upcoming') => {
    const previous = waypoints;
    const updated = waypoints.map((w) => (w.id === id ? { ...w, status } : w));
    setWaypoints(updated);
    await dbService.saveWaypoints(updated);
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        setWaypoints(previous);
        await dbService.saveWaypoints(previous);
        setSyncError('Cloud indisponible. Réessaie dans un instant.');
        return;
      }
      try {
        await cloudUpdateWaypointStatus(ctx, id, status);
      } catch (err: any) {
        setWaypoints(previous);
        await dbService.saveWaypoints(previous);
        const msg = toUserFacingError(err, 'Impossible de mettre à jour l’étape.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
  };

  const handleReorderWaypoint = async (id: string, direction: 'up' | 'down') => {
    const previous = waypoints;
    const sorted = [...waypoints].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((w) => w.id === id);
    if (idx < 0) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    const temp = sorted[idx].order;
    sorted[idx] = { ...sorted[idx], order: sorted[targetIdx].order };
    sorted[targetIdx] = { ...sorted[targetIdx], order: temp };

    setWaypoints(sorted);
    await dbService.saveWaypoints(sorted);

    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        setWaypoints(previous);
        await dbService.saveWaypoints(previous);
        const msg = 'Cloud indisponible. Réessaie dans un instant.';
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudReorderWaypoint(ctx, sorted);
      } catch (err: any) {
        setWaypoints(previous);
        await dbService.saveWaypoints(previous);
        const msg = toUserFacingError(err, 'Impossible de réordonner les étapes.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
  };

  const handleDeleteWaypoint = async (id: string) => {
    if (isCloudConfigured()) {
      const ctx = await ensureCloudCtx();
      if (!ctx) {
        const msg = 'Cloud indisponible. Réessaie dans un instant.'
        setSyncError(msg);
        throw new Error(msg);
      }
      try {
        await cloudDeleteWaypoint(ctx, id);
      } catch (err: any) {
        const msg = toUserFacingError(err, 'Impossible de supprimer l’étape.');
        setSyncError(msg);
        throw new Error(msg);
      }
    }
    const updated = waypoints.filter((w) => w.id !== id);
    setWaypoints(updated);
    await dbService.saveWaypoints(updated);
  };

  const handleSelectOnMap = (lat: number, lng: number, label?: string, emoji?: string) => {
    setMapFocus({ lat, lng, label, emoji, requestId: Date.now() });
    setActiveTab('map');
  };

  return (
    <div className="app-shell text-zinc-900">
      <Navigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        friends={friends}
        currentFriendId={currentFriendId}
        setCurrentFriendId={handleCurrentFriendChange}
        geoStatus={geoStatus}
        hasUserLocation={Boolean(userLocation)}
        booting={booting}
        isRefreshing={cloudSyncing}
        onRefresh={handleManualRefresh}
        immersive={activeTab === 'map'}
        syncError={syncError}
        onDismissSyncError={() => setSyncError('')}
      />

      <main
        ref={mainRef}
        className={`page-surface flex-1 ${
          activeTab === 'map'
            ? 'van-main-inset van-main-inset--immersive overflow-hidden'
            : 'van-main-inset overflow-y-auto'
        }`}
      >
        {mapMounted && (
          <div
            className={activeTab === 'map' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
            aria-hidden={activeTab !== 'map'}
          >
            <Suspense
              fallback={
                <div className="map-view map-view--loading flex min-h-0 flex-1 flex-col">
                  Chargement de la carte…
                </div>
              }
            >
              <MapView
                pois={pois}
                friends={friends}
                currentFriendId={currentFriendId}
                authorId={activeAuthorId}
                photos={photos}
                waypoints={waypoints}
                journal={journal}
                pastTracks={tracks}
                activeTrackPoints={getActiveTrack(tracks)?.points ?? []}
                sleepSpots={sleepSearchSpots}
                userLocation={userLocation}
                focusLocation={mapFocus}
                mapVisible={activeTab === 'map'}
                onAddPoi={handleAddPoi}
                onDeletePoi={handleDeletePoi}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'sleep' && (
          <VanSleepSearch
            onSelectOnMap={handleSelectOnMap}
            onSpotsChange={setSleepSearchSpots}
            onSaveSpot={(spot) =>
              handleAddWaypoint({
                order: waypoints.length + 1,
                title: spot.name,
                locationName: spot.address || `${spot.distanceKm} km de la ville recherchée`,
                lat: spot.lat,
                lng: spot.lng,
                status: 'upcoming',
                vanSpotType: spot.label,
                notes: spot.confidence === 'official' ? 'Lieu officiel' : 'Autorisation à vérifier',
                amenities: spot.amenities.map((amenity) =>
                  amenity === 'Eau potable' ? 'eau'
                    : amenity === 'Toilettes' ? 'wc'
                      : amenity === 'Douches' ? 'douche'
                        : amenity.toLowerCase()
                ),
              })
            }
          />
        )}

        {activeTab === 'waypoints' && (
          <WaypointsManager
            waypoints={waypoints}
            userLocation={userLocation}
            onAddWaypoint={handleAddWaypoint}
            onUpdateWaypointStatus={handleUpdateWaypointStatus}
            onReorderWaypoint={handleReorderWaypoint}
            onDeleteWaypoint={handleDeleteWaypoint}
            onSelectOnMap={handleSelectOnMap}
          />
        )}

        {activeTab === 'journal' && (
          <JournalAndPhotos
            notes={journal}
            photos={photos}
            friends={friends}
            currentFriendId={currentFriendId}
            authorId={activeAuthorId}
            userLocation={userLocation}
            onAddNote={handleAddJournalNote}
            onDeleteNote={handleDeleteJournalNote}
            onAddPhoto={handleAddPhoto}
            onDeletePhoto={handleDeletePhoto}
          />
        )}

        {activeTab === 'budget' && (
          <TricountBudget
            expenses={expenses}
            friends={friends}
            authorId={activeAuthorId}
            onAddExpense={handleAddExpense}
            onUpdateExpense={handleUpdateExpense}
            onDeleteExpense={handleDeleteExpense}
            onClearAllExpenses={handleClearAllExpenses}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileSettings
            friend={profileFriend}
            activeCrewName={activeCrewName}
            cloudReady={cloudReady}
            saving={savingProfile}
            onSave={handleUpdateOwnProfile}
            onSwitchCrewMember={handleSwitchToCrewMember}
          />
        )}

      </main>

      <AuthModal
        isOpen={isAuthModalOpen}
        allowDismiss
        onClose={() => setIsAuthModalOpen(false)}
        onAuthenticated={() => void connectCloud({ migrateLocal: true })}
      />
    </div>
  );
}

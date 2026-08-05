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
  insertExpense as cloudInsertExpense,
  updateExpense as cloudUpdateExpense,
  insertJournalNote as cloudInsertJournalNote,
  insertPhoto as cloudInsertPhoto,
  insertPoi as cloudInsertPoi,
  insertWaypoint as cloudInsertWaypoint,
  isCloudConfigured,
  fetchLiveLocations,
  formatLastActive,
  getTripInviteCode,
  loadTripBundle,
  mergeLiveLocationsIntoFriends,
  syncLocalDataToCloud,
  verifyCloudSchema,
  reorderWaypoint as cloudReorderWaypoint,
  setActiveTripId,
  subscribeTripRealtime,
  updateWaypointStatus as cloudUpdateWaypointStatus,
  updateOwnProfile,
  upsertLiveLocation,
} from './services/supabaseRepo';
import { SYNC_DEBOUNCE_MS } from './services/syncConfig';
import {
  getPowerProfile,
  isDocumentVisible,
  setPowerModeTab,
  subscribePowerMode,
  type PowerProfile,
} from './lib/powerMode';
import { Navigation } from './components/Navigation';
import { WaypointsManager } from './components/WaypointsManager';
import { JournalAndPhotos } from './components/JournalAndPhotos';
import { TricountBudget } from './components/TricountBudget';
import { ProfileSettings } from './components/ProfileSettings';
import { VanSleepSearch } from './components/VanSleepSearch';
import { AuthModal } from './components/AuthModal';
import { calculateHaversineDistance } from './services/gpx';
import { startGeolocationWatch, type GeoStatus } from './services/geolocation';
import { toUserFacingError } from './lib/userFacingError';
import {
  hydrateFriendAvatars,
  readCrewCustomization,
  resolveFriendAvatar,
  writeCrewCustomization,
  type CrewCustomization,
} from './lib/crewAvatars';
import {
  CREW_MEMBER_NAMES,
  backfillCrewProfileAvatars,
  ensureCrewAccounts,
  ensureCrewSession,
  isCrewMemberName,
  resolvePreferredCrewName,
  switchToCrewMember,
  type CrewMemberName,
} from './services/supabase';

const MapView = lazy(() =>
  import('./components/MapView').then((module) => ({ default: module.MapView }))
);
const ACTIVE_TAB_KEY = 'van_active_tab_v1';
const CREW_CUSTOMIZATIONS_KEY = 'van_crew_customizations_v1';
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
  const [savingProfile, setSavingProfile] = useState(false);

  const cloudRef = useRef<CloudContext | null>(null);
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
    const crewFriends = CREW_MEMBER_NAMES.flatMap((name) => {
      const friend = bundle.friends.find(
        (candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase()
      );
      if (!friend) return [];
      crewAccountNamesRef.current[friend.id] = name;
      const customization = readCrewCustomization(crewCustomizationsRef.current, friend.id, name);
      const displayName = customization?.name?.trim() || friend.name;
      return [{
        ...friend,
        name: displayName,
        avatar: resolveFriendAvatar(
          displayName,
          friend.color,
          customization?.avatar || friend.avatar
        ),
      }];
    });
    const visibleFriends = crewFriends.length ? crewFriends : bundle.friends;
    const selectedFriendId = visibleFriends.some(
      (friend) => friend.id === currentFriendIdRef.current
    )
      ? currentFriendIdRef.current
      : visibleFriends.find((friend) => friend.id === userId)?.id ?? visibleFriends[0]?.id ?? userId;

    setFriends(visibleFriends);
    setPois(bundle.pois);
    setJournal(bundle.journal);
    setExpenses(bundle.expenses);
    setPhotos(bundle.photos);
    setWaypoints(bundle.waypoints);
    setTracks(bundle.tracks);
    currentFriendIdRef.current = selectedFriendId;
    setCurrentFriendId(selectedFriendId);
    await mirrorLocal({ ...bundle, friends: visibleFriends, currentFriendId: selectedFriendId });
  };

  const connectCloud = async () => {
    setSyncError('');
    if (!isCloudConfigured()) {
      cloudRef.current = null;
      setCloudReady(false);
      return false;
    }

    try {
      await ensureCrewSession(resolvePreferredCrewName());
      void backfillCrewProfileAvatars();

      let ctx = await bootstrapCloud();
      if (!ctx) {
        cloudRef.current = null;
        setCloudReady(false);
        setIsAuthModalOpen(true);
        return false;
      }

      cloudRef.current = ctx;
      setActiveTripIdState(ctx.tripId);

      let bundle = await loadTripBundle(ctx);

      const schemaIssues = await verifyCloudSchema(ctx);
      if (schemaIssues.length) {
        console.warn('Schéma Supabase incomplet (VanPay):', schemaIssues.join(', '));
      }

      const local = {
        pois: await dbService.getPois(),
        waypoints: await dbService.getWaypoints(),
        journal: await dbService.getJournal(),
        photos: await dbService.getPhotos(),
        expenses: await dbService.getExpenses(),
        tracks: await dbService.getTracks(),
      };

      try {
        bundle = await syncLocalDataToCloud(ctx, local);
      } catch (pushErr) {
        console.warn('Push local → cloud failed', pushErr);
      }

      const existingCrewNames = new Set(
        bundle.friends.map((friend) => friend.name.trim().toLowerCase())
      );
      const crewIsComplete = CREW_MEMBER_NAMES.every((name) =>
        existingCrewNames.has(name.toLowerCase())
      );

      if (!crewIsComplete) {
        try {
          const inviteCode = await getTripInviteCode(ctx);
          await ensureCrewAccounts(inviteCode);
          bundle = await loadTripBundle(ctx);
        } catch (crewErr) {
          console.warn('Crew bootstrap failed', crewErr);
        }
      }

      await applyBundle(bundle, ctx.user.id);
      setCloudReady(true);
      setIsAuthModalOpen(false);
      return true;
    } catch (err: any) {
      console.error('Cloud sync failed', err);
      setSyncError(toUserFacingError(err, 'Synchronisation indisponible.'));
      cloudRef.current = null;
      setCloudReady(false);
      return false;
    }
  };

  useEffect(() => {
    async function init() {
      const rawFriends = await dbService.getFriends();
      const f = hydrateFriendAvatars(rawFriends);
      if (rawFriends.some((friend, index) => friend.avatar !== f[index]?.avatar)) {
        await dbService.saveFriends(f);
      }
      const p = await dbService.getPois();
      const j = await dbService.getJournal();
      const e = await dbService.getExpenses();
      const ph = await dbService.getPhotos();
      const w = await dbService.getWaypoints();
      const t = await dbService.getTracks();
      const currF = await dbService.getCurrentFriendId();

      setFriends(hydrateFriendAvatars(f));
      setPois(p);
      setJournal(j);
      setExpenses(e);
      setPhotos(ph);
      setWaypoints(w);
      setTracks(t);
      const initialFriendId = currF || 'adel';
      currentFriendIdRef.current = initialFriendId;
      setCurrentFriendId(initialFriendId);

      if (isCloudConfigured()) {
        await connectCloud();
      }
      setBooting(false);
    }
    void init();
  }, []);

  useEffect(() => {
    const ctx = cloudRef.current;
    if (!cloudReady || !ctx) return;

    let refreshTimer: number | undefined;
    let refreshing = false;

    const refreshTripBundle = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const bundle = await loadTripBundle(ctx);
        await applyBundle(bundle, ctx.user.id);
      } catch (err) {
        console.warn('Trip refresh failed', err);
      } finally {
        refreshing = false;
      }
    };

    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshTripBundle();
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
      void refreshTripBundle();
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
        const { latitude, longitude, altitude } = position.coords;
        const now = position.timestamp || Date.now();

        const altMeters =
          altitude != null && Number.isFinite(altitude) ? Math.round(altitude) : undefined;

        const newPoint: GpsPoint = {
          lat: latitude,
          lng: longitude,
          altitude: altMeters,
          timestamp: now,
        };

        userLocationRef.current = newPoint;

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

  const handleSwitchToCrewMember = (name: CrewMemberName) => {
    const friend =
      friends.find((candidate) => crewAccountNamesRef.current[candidate.id] === name) ||
      friends.find((candidate) => candidate.name.trim().toLowerCase() === name.toLowerCase());
    if (friend) void handleCurrentFriendChange(friend.id);
  };

  const handleUpdateOwnProfile = async (patch: { name: string; avatar: string }) => {
    const friendId = currentFriendIdRef.current;
    const friend = friends.find((candidate) => candidate.id === friendId);
    if (!friend) return;

    const crewName = crewAccountNamesRef.current[friendId] as CrewMemberName | undefined;
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

    const ctx = cloudRef.current;
    if (ctx && ctx.user.id === friendId) {
      setSavingProfile(true);
      try {
        await updateOwnProfile(ctx, { name: patch.name, avatar: patch.avatar });
        await ctx.supabase.auth.updateUser({
          data: { name: patch.name, avatar_url: patch.avatar },
        });
      } finally {
        setSavingProfile(false);
      }
    }
  };

  const profileFriend = friends.find((friend) => friend.id === currentFriendId) || friends[0];
  const activeCrewName = profileFriend
    ? (crewAccountNamesRef.current[profileFriend.id] ||
        (isCrewMemberName(profileFriend.name) ? profileFriend.name : undefined))
    : undefined;

  const handleCurrentFriendChange = async (id: string) => {
    if (!friends.some((friend) => friend.id === id)) return;

    const ctx = cloudRef.current;
    const friend = friends.find((candidate) => candidate.id === id);
    const crewAccountName = crewAccountNamesRef.current[id];
    if (ctx && friend && id !== ctx.user.id && crewAccountName) {
      setBooting(true);
      setCloudReady(false);
      setSyncError('');
      try {
        const user = await switchToCrewMember(crewAccountName);
        currentFriendIdRef.current = user.id;
        setCurrentFriendId(user.id);
        await dbService.saveCurrentFriendId(user.id);
        await connectCloud();
      } catch (err) {
        setSyncError(toUserFacingError(err, `Impossible de passer sur le profil ${friend.name}.`));
      } finally {
        setBooting(false);
      }
      return;
    }

    currentFriendIdRef.current = id;
    setCurrentFriendId(id);
    void dbService.saveCurrentFriendId(id);
  };

  const handleAddPoi = async (newPoiData: Omit<Poi, 'id' | 'createdAt'>) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        const saved = await cloudInsertPoi(ctx, newPoiData);
        const updated = [saved, ...pois];
        setPois(updated);
        await dbService.savePois(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible d’ajouter ce spot.'));
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

  const handleAddJournalNote = async (newNoteData: Omit<JournalNote, 'id'>) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        const saved = await cloudInsertJournalNote(ctx, newNoteData);
        const updated = [saved, ...journal];
        setJournal(updated);
        await dbService.saveJournal(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible d’enregistrer la note.'));
      }
    }
    const newNote: JournalNote = { ...newNoteData, id: 'note_' + Date.now() };
    const updated = [newNote, ...journal];
    setJournal(updated);
    await dbService.saveJournal(updated);
  };

  const handleAddPhoto = async (newPhotoData: Omit<TripPhoto, 'id'>) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        const saved = await cloudInsertPhoto(ctx, newPhotoData);
        const updated = [saved, ...photos];
        setPhotos(updated);
        await dbService.savePhotos(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible d’ajouter la photo.'));
      }
    }
    const newPhoto: TripPhoto = { ...newPhotoData, id: 'photo_' + Date.now() };
    const updated = [newPhoto, ...photos];
    setPhotos(updated);
    await dbService.savePhotos(updated);
  };

  const handleDeletePhoto = async (id: string) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudDeletePhoto(ctx, id);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de supprimer la photo.'));
        return;
      }
    }
    const updated = photos.filter((photo) => photo.id !== id);
    setPhotos(updated);
    await dbService.savePhotos(updated);
  };

  const handleAddExpense = async (newExpData: Omit<Expense, 'id'>) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        const saved = await cloudInsertExpense(ctx, newExpData);
        const updated = [saved, ...expenses];
        setExpenses(updated);
        await dbService.saveExpenses(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible d’ajouter la dépense.'));
      }
    }
    const newExp: Expense = { ...newExpData, id: 'exp_' + Date.now() };
    const updated = [newExp, ...expenses];
    setExpenses(updated);
    await dbService.saveExpenses(updated);
  };

  const handleUpdateExpense = async (id: string, data: Omit<Expense, 'id'>) => {
    const ctx = cloudRef.current;
    if (ctx && !id.startsWith('exp_')) {
      try {
        const saved = await cloudUpdateExpense(ctx, id, data);
        const updated = expenses.map((expense) => (expense.id === id ? saved : expense));
        setExpenses(updated);
        await dbService.saveExpenses(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de modifier la dépense.'));
        return;
      }
    }
    const updated = expenses.map((expense) => (expense.id === id ? { ...data, id } : expense));
    setExpenses(updated);
    await dbService.saveExpenses(updated);
  };

  const handleDeleteExpense = async (id: string) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudDeleteExpense(ctx, id);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de supprimer la dépense.'));
        return;
      }
    }
    const updated = expenses.filter((e) => e.id !== id);
    setExpenses(updated);
    await dbService.saveExpenses(updated);
  };

  const handleClearAllExpenses = async () => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudDeleteAllExpenses(ctx);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de réinitialiser les dépenses.'));
        return;
      }
    }
    setExpenses([]);
    await dbService.saveExpenses([]);
  };

  const handleAddWaypoint = async (newWpData: Omit<Waypoint, 'id'>) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        const saved = await cloudInsertWaypoint(ctx, newWpData);
        const updated = [...waypoints, saved];
        setWaypoints(updated);
        await dbService.saveWaypoints(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible d’ajouter l’étape.'));
      }
    }
    const newWp: Waypoint = { ...newWpData, id: 'wp_' + Date.now() };
    const updated = [...waypoints, newWp];
    setWaypoints(updated);
    await dbService.saveWaypoints(updated);
  };

  const handleUpdateWaypointStatus = async (id: string, status: 'done' | 'active' | 'upcoming') => {
    const updated = waypoints.map((w) => (w.id === id ? { ...w, status } : w));
    setWaypoints(updated);
    await dbService.saveWaypoints(updated);
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudUpdateWaypointStatus(ctx, id, status);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de mettre à jour l’étape.'));
      }
    }
  };

  const handleReorderWaypoint = async (id: string, direction: 'up' | 'down') => {
    const sorted = [...waypoints].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((w) => w.id === id);
    if (idx < 0) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= sorted.length) return;

    const temp = sorted[idx].order;
    sorted[idx].order = sorted[targetIdx].order;
    sorted[targetIdx].order = temp;

    setWaypoints(sorted);
    await dbService.saveWaypoints(sorted);

    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudReorderWaypoint(ctx, sorted);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de réordonner les étapes.'));
      }
    }
  };

  const handleDeleteWaypoint = async (id: string) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudDeleteWaypoint(ctx, id);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de supprimer l’étape.'));
        return;
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
        immersive={activeTab === 'map'}
        syncError={syncError ? toUserFacingError(syncError) : ''}
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
                photos={photos}
                waypoints={waypoints}
                journal={journal}
                pastTracks={tracks}
                sleepSpots={sleepSearchSpots}
                userLocation={userLocation}
                focusLocation={mapFocus}
                mapVisible={activeTab === 'map'}
                onAddPoi={handleAddPoi}
                onAddPhoto={handleAddPhoto}
              />
            </Suspense>
          </div>
        )}

        {activeTab === 'sleep' && (
          <VanSleepSearch
            onSelectOnMap={handleSelectOnMap}
            onSpotsChange={setSleepSearchSpots}
            onSaveSpot={(spot) => void handleAddWaypoint({
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
            })}
          />
        )}

        {activeTab === 'waypoints' && (
          <WaypointsManager
            waypoints={waypoints}
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
            userLocation={userLocation}
            onAddNote={handleAddJournalNote}
            onAddPhoto={handleAddPhoto}
            onDeletePhoto={handleDeletePhoto}
          />
        )}

        {activeTab === 'budget' && (
          <TricountBudget
            expenses={expenses}
            friends={friends}
            currentFriendId={currentFriendId}
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
        onAuthenticated={() => void connectCloud()}
      />
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import {
  Friend,
  Poi,
  JournalNote,
  Expense,
  TripPhoto,
  Waypoint,
  GpsTrack,
  GpsPoint,
  TabType,
} from './types';
import { dbService } from './services/db';
import {
  bootstrapCloud,
  CloudContext,
  deleteExpense as cloudDeleteExpense,
  deletePhoto as cloudDeletePhoto,
  deleteTrack as cloudDeleteTrack,
  deleteWaypoint as cloudDeleteWaypoint,
  insertExpense as cloudInsertExpense,
  insertJournalNote as cloudInsertJournalNote,
  insertPhoto as cloudInsertPhoto,
  insertPoi as cloudInsertPoi,
  insertTrack as cloudInsertTrack,
  insertWaypoint as cloudInsertWaypoint,
  isCloudConfigured,
  fetchLiveLocations,
  formatLastActive,
  getTripInviteCode,
  joinTripByCode,
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
import {
  SYNC_ACTIVE_LABEL_TICK_MS,
  SYNC_DEBOUNCE_MS,
  SYNC_FULL_INTERVAL_MS,
  SYNC_LIVE_LOCATION_MOVE_M,
  SYNC_LIVE_LOCATION_POLL_MS,
  SYNC_LIVE_LOCATION_PUSH_MS,
} from './services/syncConfig';
import { Navigation, VanBottomNav } from './components/Navigation';
import { MapView } from './components/MapView';
import { GpsTracker } from './components/GpsTracker';
import { WaypointsManager } from './components/WaypointsManager';
import { JournalAndPhotos } from './components/JournalAndPhotos';
import { TricountBudget } from './components/TricountBudget';
import { LiveRadar } from './components/LiveRadar';
import { WalkieTalkie } from './components/WalkieTalkie';
import { VanSleepSearch } from './components/VanSleepSearch';
import { AuthModal } from './components/AuthModal';
import { useWalkieRadio } from './hooks/useWalkieRadio';
import { calculateHaversineDistance } from './services/gpx';
import {
  avgMovingSpeedKmH,
  maxSpeedKmH,
  shouldAcceptTrackPoint,
  smoothSpeedKmH,
  speedFromCoords,
  trackDistanceKm,
} from './services/gpsMetrics';
import { startGeolocationWatch, type GeoStatus } from './services/geolocation';
import { toUserFacingError } from './lib/userFacingError';
import {
  CREW_MEMBER_NAMES,
  ensureCrewAccounts,
  isCrewAccount,
  switchToCrewMember,
} from './services/supabase';

const ACTIVE_TAB_KEY = 'van_active_tab_v1';
const CREW_CUSTOMIZATIONS_KEY = 'van_crew_customizations_v1';
const VALID_TABS: TabType[] = ['map', 'sleep', 'gps', 'radio', 'waypoints', 'journal', 'budget', 'radar'];

type CrewCustomization = { name?: string; avatar?: string };

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

  const setActiveTab = (tab: TabType) => {
    setActiveTabState(tab);
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

  const [userLocation, setUserLocation] = useState<GpsPoint | null>(null);
  const [isGpsRecording, setIsGpsRecording] = useState(false);
  const [isGpsPaused, setIsGpsPaused] = useState(false);
  const [activeTrackPoints, setActiveTrackPoints] = useState<GpsPoint[]>([]);
  const [totalRecordedDistanceKm, setTotalRecordedDistanceKm] = useState(0);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [currentAltitude, setCurrentAltitude] = useState<number | null>(null);
  const [gpsAccuracyM, setGpsAccuracyM] = useState<number | null>(null);
  const [recordingElapsedSec, setRecordingElapsedSec] = useState(0);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [activeTripId, setActiveTripIdState] = useState<string | null>(null);
  const [syncError, setSyncError] = useState('');
  const [booting, setBooting] = useState(true);

  const cloudRef = useRef<CloudContext | null>(null);
  const lastLivePushRef = useRef(0);
  const lastLiveCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const userLocationRef = useRef<GpsPoint | null>(null);
  const currentFriendIdRef = useRef(currentFriendId);
  const crewCustomizationsRef = useRef<Record<string, CrewCustomization>>(readCrewCustomizations());
  const crewAccountNamesRef = useRef<Record<string, (typeof CREW_MEMBER_NAMES)[number]>>({});
  const isGpsRecordingRef = useRef(isGpsRecording);
  const isGpsPausedRef = useRef(isGpsPaused);
  const displaySpeedRef = useRef(0);
  const recordingStartedAtRef = useRef<number | null>(null);
  const totalPausedMsRef = useRef(0);
  const pausedAtRef = useRef<number | null>(null);
  const [geoStatus, setGeoStatus] = useState<GeoStatus>({ state: 'idle' });

  const walkie = useWalkieRadio({
    cloudContext: cloudReady ? cloudRef.current : null,
    friends,
    currentFriendId,
  });

  useEffect(() => {
    currentFriendIdRef.current = currentFriendId;
  }, [currentFriendId]);

  useEffect(() => {
    isGpsRecordingRef.current = isGpsRecording;
  }, [isGpsRecording]);

  useEffect(() => {
    isGpsPausedRef.current = isGpsPaused;
  }, [isGpsPaused]);

  // Precise wall-clock duration (excludes pause time).
  useEffect(() => {
    if (!isGpsRecording) {
      setRecordingElapsedSec(0);
      return;
    }

    const tick = () => {
      const started = recordingStartedAtRef.current;
      if (started == null) {
        setRecordingElapsedSec(0);
        return;
      }
      const pausedExtra =
        isGpsPausedRef.current && pausedAtRef.current != null
          ? Date.now() - pausedAtRef.current
          : 0;
      const elapsedMs = Date.now() - started - totalPausedMsRef.current - pausedExtra;
      setRecordingElapsedSec(Math.max(0, Math.floor(elapsedMs / 1000)));
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [isGpsRecording, isGpsPaused]);

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
      const customization = crewCustomizationsRef.current[friend.id];
      return [{
        ...friend,
        name: customization?.name?.trim() || friend.name,
        avatar: customization?.avatar || friend.avatar,
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
      let ctx = await bootstrapCloud();
      if (!ctx) {
        cloudRef.current = null;
        setCloudReady(false);
        setIsAuthModalOpen(true);
        return false;
      }

      cloudRef.current = ctx;
      setActiveTripIdState(ctx.tripId);
      const local = {
        pois: await dbService.getPois(),
        waypoints: await dbService.getWaypoints(),
        journal: await dbService.getJournal(),
        photos: await dbService.getPhotos(),
        expenses: await dbService.getExpenses(),
        tracks: await dbService.getTracks(),
      };
      const schemaIssues = await verifyCloudSchema(ctx);
      if (schemaIssues.length) {
        setSyncError(
          `Schéma Supabase incomplet (${schemaIssues.join(', ')}). Exécute supabase/ensure_full_sync.sql dans le SQL Editor.`
        );
      }

      let bundle = await syncLocalDataToCloud(ctx, local);
      const existingCrewNames = new Set(
        bundle.friends.map((friend) => friend.name.trim().toLowerCase())
      );
      const crewIsComplete = CREW_MEMBER_NAMES.every((name) =>
        existingCrewNames.has(name.toLowerCase())
      );

      if (!crewIsComplete) {
        const inviteCode = await getTripInviteCode(ctx);
        await ensureCrewAccounts(inviteCode);
        bundle = await loadTripBundle(ctx);
      }

      if (!isCrewAccount(ctx.user)) {
        await switchToCrewMember('Adel');
        const crewContext = await bootstrapCloud();
        if (!crewContext) throw new Error('Impossible d’ouvrir le profil Adel.');
        ctx = crewContext;
        cloudRef.current = ctx;
        setActiveTripIdState(ctx.tripId);
        currentFriendIdRef.current = ctx.user.id;
        bundle = await loadTripBundle(ctx);
      }

      await applyBundle(bundle, ctx.user.id);
      setCloudReady(true);
      setIsAuthModalOpen(false);
      return true;
    } catch (err: any) {
      setSyncError(toUserFacingError(err, 'Synchronisation indisponible.'));
      cloudRef.current = null;
      setCloudReady(false);
      return false;
    }
  };

  useEffect(() => {
    async function init() {
      const f = await dbService.getFriends();
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
        void dbService.saveFriends(updated);
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
            void dbService.saveFriends(updated);
            return updated;
          });
        })
        .catch((err) => console.warn('Live location poll failed', err));
    }, SYNC_LIVE_LOCATION_POLL_MS);

    const fullSyncInterval = window.setInterval(() => {
      void refreshTripBundle();
    }, SYNC_FULL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') scheduleRefresh();
    };
    const onWindowFocus = () => scheduleRefresh();
    const onOnline = () => scheduleRefresh();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('online', onOnline);

    const tickActiveLabels = window.setInterval(() => {
      setFriends((prev) =>
        prev.map((friend) =>
          friend.lastActiveAt
            ? { ...friend, lastActive: formatLastActive(friend.lastActiveAt) }
            : friend
        )
      );
    }, SYNC_ACTIVE_LABEL_TICK_MS);

    return () => {
      window.clearTimeout(refreshTimer);
      window.clearInterval(pollLocations);
      window.clearInterval(fullSyncInterval);
      window.clearInterval(tickActiveLabels);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('online', onOnline);
      unsubscribe();
    };
  }, [cloudReady, activeTripId]);

  useEffect(() => {
    const stop = startGeolocationWatch({
      onStatus: (status) => {
        setGeoStatus(status);
        if (status.state === 'error' && status.fatal) {
          userLocationRef.current = null;
          setUserLocation(null);
        }
      },
      onPosition: (position) => {
        const { latitude, longitude, altitude, accuracy } = position.coords;
        const now = position.timestamp || Date.now();
        const prevPoint = userLocationRef.current;
        const rawSpeedKmH = speedFromCoords(position.coords, prevPoint, now);
        const displaySpeed = smoothSpeedKmH(displaySpeedRef.current, rawSpeedKmH, 0.45);
        displaySpeedRef.current = displaySpeed;

        const altMeters =
          altitude != null && Number.isFinite(altitude) ? Math.round(altitude) : undefined;
        const accuracyM =
          accuracy != null && Number.isFinite(accuracy) ? Math.round(accuracy) : null;

        const newPoint: GpsPoint = {
          lat: latitude,
          lng: longitude,
          altitude: altMeters,
          speed: rawSpeedKmH,
          timestamp: now,
        };

        userLocationRef.current = newPoint;
        setUserLocation(newPoint);
        setCurrentSpeed(displaySpeed);
        setGpsAccuracyM(accuracyM);
        if (altMeters != null) setCurrentAltitude(altMeters);

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
          void dbService.saveFriends(updated);
          return updated;
        });

        const ctx = cloudRef.current;
        if (ctx) {
          const prev = lastLiveCoordsRef.current;
          const movedMeters = prev
            ? calculateHaversineDistance(prev.lat, prev.lng, latitude, longitude) * 1000
            : Number.POSITIVE_INFINITY;
          const dueByTime = now - lastLivePushRef.current > SYNC_LIVE_LOCATION_PUSH_MS;
          const dueByMove = movedMeters > SYNC_LIVE_LOCATION_MOVE_M;
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

        if (isGpsRecordingRef.current && !isGpsPausedRef.current) {
          setActiveTrackPoints((prev) => {
            const lastAccepted = prev.length ? prev[prev.length - 1] : null;
            const { accept } = shouldAcceptTrackPoint(newPoint, lastAccepted, accuracyM);
            if (!accept) return prev;
            const next = [...prev, newPoint];
            setTotalRecordedDistanceKm(Number(trackDistanceKm(next).toFixed(3)));
            return next;
          });
        }
      },
    });

    return stop;
  }, []);

  const handleJoinTripByCode = async (code: string) => {
    const ctx = cloudRef.current;
    if (!ctx) {
      setIsAuthModalOpen(true);
      throw new Error('Connecte-toi pour rejoindre un voyage.');
    }
    const tripId = await joinTripByCode(ctx, code);
    setActiveTripId(tripId);
    cloudRef.current = { ...ctx, tripId };
    setActiveTripIdState(tripId);
    const bundle = await loadTripBundle(cloudRef.current);
    await applyBundle(bundle, ctx.user.id);
    setCloudReady(true);
    setSyncError('');
  };

  const handleFetchInviteCode = async () => {
    const ctx = cloudRef.current;
    if (!ctx) throw new Error('Voyage cloud indisponible.');
    return getTripInviteCode(ctx);
  };

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

  const handleUpdateFriendProfile = (
    id: string,
    changes: { name: string; avatar?: string }
  ) => {
    const trimmedName = changes.name.trim();
    if (!trimmedName) return;

    const ctx = cloudRef.current;
    if (ctx && id === ctx.user.id) {
      void updateOwnProfile(ctx, {
        name: trimmedName,
        ...(changes.avatar ? { avatar: changes.avatar } : {}),
      }).catch((err) => {
        setSyncError(toUserFacingError(err, 'Impossible de mettre à jour le profil.'));
      });
    }

    const current = crewCustomizationsRef.current[id] || {};
    crewCustomizationsRef.current = {
      ...crewCustomizationsRef.current,
      [id]: {
        ...current,
        name: trimmedName,
        ...(changes.avatar ? { avatar: changes.avatar } : {}),
      },
    };
    localStorage.setItem(
      CREW_CUSTOMIZATIONS_KEY,
      JSON.stringify(crewCustomizationsRef.current)
    );

    setFriends((previous) => {
      const updated = previous.map((friend) =>
        friend.id === id
          ? { ...friend, name: trimmedName, avatar: changes.avatar || friend.avatar }
          : friend
      );
      void dbService.saveFriends(updated);
      return updated;
    });
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

  const resetRecordingClock = () => {
    recordingStartedAtRef.current = null;
    totalPausedMsRef.current = 0;
    pausedAtRef.current = null;
    setRecordingElapsedSec(0);
    setIsGpsPaused(false);
  };

  const handleStartGpsRecording = () => {
    const seed = userLocationRef.current ?? userLocation;
    recordingStartedAtRef.current = Date.now();
    totalPausedMsRef.current = 0;
    pausedAtRef.current = null;
    setIsGpsPaused(false);
    setIsGpsRecording(true);
    setActiveTrackPoints(seed ? [seed] : []);
    setTotalRecordedDistanceKm(0);
    setRecordingElapsedSec(0);
  };

  const handlePauseGpsRecording = () => {
    setIsGpsPaused((paused) => {
      if (!paused) {
        pausedAtRef.current = Date.now();
        return true;
      }
      if (pausedAtRef.current != null) {
        totalPausedMsRef.current += Date.now() - pausedAtRef.current;
      }
      pausedAtRef.current = null;
      return false;
    });
  };

  const handleStopAndSaveGpsRecording = async (title: string) => {
    if (pausedAtRef.current != null) {
      totalPausedMsRef.current += Date.now() - pausedAtRef.current;
      pausedAtRef.current = null;
    }

    const points = activeTrackPoints;
    const distanceKm = Number(trackDistanceKm(points).toFixed(3));
    const maxSpd = Number(maxSpeedKmH(points).toFixed(1));
    const avgSpd = Number(avgMovingSpeedKmH(points, distanceKm).toFixed(1));

    setIsGpsRecording(false);
    resetRecordingClock();

    if (points.length > 0) {
      const draft: Omit<GpsTrack, 'id'> = {
        title,
        date: new Date().toISOString().split('T')[0],
        startTime: points[0].timestamp,
        endTime: Date.now(),
        distanceKm,
        avgSpeedKmH: avgSpd,
        maxSpeedKmH: maxSpd,
        points,
        createdByFriendId: currentFriendId,
      };

      const ctx = cloudRef.current;
      if (ctx) {
        try {
          const saved = await cloudInsertTrack(ctx, draft);
          const updated = [saved, ...tracks];
          setTracks(updated);
          await dbService.saveTracks(updated);
          setActiveTrackPoints([]);
          setTotalRecordedDistanceKm(0);
          return;
        } catch (err: any) {
          setSyncError(toUserFacingError(err, 'Impossible d’enregistrer la trace GPS.'));
        }
      }

      const newTrack: GpsTrack = { ...draft, id: 'track_' + Date.now() };
      const updated = [newTrack, ...tracks];
      setTracks(updated);
      await dbService.saveTracks(updated);
    }
    setActiveTrackPoints([]);
    setTotalRecordedDistanceKm(0);
  };

  const handleImportGpxTrack = async (track: GpsTrack) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        const saved = await cloudInsertTrack(ctx, track);
        const updated = [saved, ...tracks];
        setTracks(updated);
        await dbService.saveTracks(updated);
        return;
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible d’importer le fichier GPX.'));
      }
    }
    const updated = [track, ...tracks];
    setTracks(updated);
    await dbService.saveTracks(updated);
  };

  const handleDeleteTrack = async (trackId: string) => {
    const ctx = cloudRef.current;
    if (ctx) {
      try {
        await cloudDeleteTrack(ctx, trackId);
      } catch (err: any) {
        setSyncError(toUserFacingError(err, 'Impossible de supprimer la trace.'));
        return;
      }
    }
    const updated = tracks.filter((t) => t.id !== trackId);
    setTracks(updated);
    await dbService.saveTracks(updated);
  };

  const handleSelectOnMap = (lat: number, lng: number, label?: string, emoji?: string) => {
    setMapFocus({ lat, lng, label, emoji, requestId: Date.now() });
    setActiveTab('map');
  };

  return (
    <div className="app-shell flex h-dvh max-h-dvh flex-col overflow-hidden text-zinc-900">
      <Navigation
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        friends={friends}
        currentFriendId={currentFriendId}
        setCurrentFriendId={handleCurrentFriendChange}
        isGpsRecording={isGpsRecording}
        geoStatus={geoStatus}
        hasUserLocation={Boolean(userLocation)}
        booting={booting}
        syncError={syncError ? toUserFacingError(syncError) : ''}
        onDismissSyncError={() => setSyncError('')}
      />

      {walkie.channelReady && !walkie.audioUnlocked && (
        <button
          type="button"
          onClick={() => void walkie.unlockAudio()}
          className="fixed left-1/2 top-[calc(var(--van-header-h)+0.35rem)] z-[60] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 truncate rounded-full bg-[#eb6c32] px-3 py-2 text-[11px] font-extrabold text-white shadow-[0_12px_30px_rgba(235,108,50,.35)] ring-1 ring-white/10"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-white" />
          <span className="truncate">Activer la radio pour entendre l’équipage</span>
        </button>
      )}

      {walkie.activeSpeaker && activeTab !== 'radio' && walkie.audioUnlocked && (
        <button
          type="button"
          onClick={() => {
            void walkie.unlockAudio();
            setActiveTab('radio');
          }}
          className="fixed left-1/2 top-[calc(var(--van-header-h)+0.35rem)] z-[60] flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 truncate rounded-full bg-[#17352b] px-3 py-2 text-[11px] font-extrabold text-white shadow-[0_12px_30px_rgba(23,53,43,.35)] ring-1 ring-white/10"
        >
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#eb6c32]" />
          <span className="truncate">{walkie.activeSpeaker.name} parle en radio</span>
        </button>
      )}

      <main
        ref={mainRef}
        className={`page-surface van-main-inset min-h-0 flex-1 w-full ${
          activeTab === 'radio' || activeTab === 'map' ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
      >
        <div className={activeTab === 'map' ? 'h-full' : 'hidden'} aria-hidden={activeTab !== 'map'}>
          <MapView
            pois={pois}
            friends={friends}
            currentFriendId={currentFriendId}
            activeTrackPoints={activeTrackPoints}
            pastTracks={tracks}
            photos={photos}
            waypoints={waypoints}
            userLocation={userLocation}
            focusLocation={mapFocus}
            mapVisible={activeTab === 'map'}
            onAddPoi={handleAddPoi}
            onAddPhoto={handleAddPhoto}
          />
        </div>

        {activeTab === 'sleep' && (
          <VanSleepSearch
            onSelectOnMap={handleSelectOnMap}
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

        {activeTab === 'gps' && (
          <GpsTracker
            isRecording={isGpsRecording}
            isPaused={isGpsPaused}
            activeTrackPoints={activeTrackPoints}
            currentSpeed={currentSpeed}
            currentAltitude={currentAltitude}
            totalDistanceKm={totalRecordedDistanceKm}
            elapsedSeconds={recordingElapsedSec}
            gpsAccuracyM={gpsAccuracyM}
            geoStatus={geoStatus}
            pastTracks={tracks}
            onStartRecording={handleStartGpsRecording}
            onPauseRecording={handlePauseGpsRecording}
            onStopAndSaveRecording={handleStopAndSaveGpsRecording}
            onImportGpx={handleImportGpxTrack}
            onDeleteTrack={handleDeleteTrack}
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
            onDeleteExpense={handleDeleteExpense}
          />
        )}

        {activeTab === 'radio' && (
          <WalkieTalkie {...walkie} />
        )}

        {activeTab === 'radar' && (
          <LiveRadar
            friends={friends}
            currentFriendId={currentFriendId}
            userLocation={userLocation}
            cloudContext={cloudReady ? cloudRef.current : null}
            geoStatus={geoStatus}
            onFetchInviteCode={handleFetchInviteCode}
            onJoinTripByCode={handleJoinTripByCode}
            onUpdateFriendProfile={handleUpdateFriendProfile}
          />
        )}
      </main>

      <VanBottomNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isGpsRecording={isGpsRecording}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        allowDismiss
        onClose={() => setIsAuthModalOpen(false)}
        onAuthenticated={() => void connectCloud()}
      />
    </div>
  );
}

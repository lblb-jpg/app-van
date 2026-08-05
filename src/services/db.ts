import { get, set } from 'idb-keyval';
import { Friend, GpsTrack, Poi, JournalNote, TripPhoto, Expense, Waypoint } from '../types';
import { CREW_DEFAULT_AVATARS, CREW_DEFAULT_COLORS } from '../lib/crewAvatars';

// Crew accounts only — all journey data starts empty for a clean deploy.
export const DEFAULT_FRIENDS: Friend[] = [
  {
    id: 'adel',
    name: 'Adel',
    avatar: CREW_DEFAULT_AVATARS.Adel,
    color: CREW_DEFAULT_COLORS.Adel,
    isCurrentUser: true
  },
  {
    id: 'paul',
    name: 'Paul',
    avatar: CREW_DEFAULT_AVATARS.Paul,
    color: CREW_DEFAULT_COLORS.Paul
  },
  {
    id: 'yanis',
    name: 'Yanis',
    avatar: CREW_DEFAULT_AVATARS.Yanis,
    color: CREW_DEFAULT_COLORS.Yanis
  }
];

export const DEFAULT_WAYPOINTS: Waypoint[] = [];
export const DEFAULT_POIS: Poi[] = [];
export const DEFAULT_JOURNAL: JournalNote[] = [];
export const DEFAULT_EXPENSES: Expense[] = [];
export const DEFAULT_PHOTOS: TripPhoto[] = [];
export const DEFAULT_TRACKS: GpsTrack[] = [];


// IDB Keys
const KEYS = {
  FRIENDS: 'van_friends_v2',
  POIS: 'van_pois_v2',
  JOURNAL: 'van_journal_v2',
  EXPENSES: 'van_expenses_v2',
  PHOTOS: 'van_photos_v2',
  WAYPOINTS: 'van_waypoints_v2',
  TRACKS: 'van_tracks_v2',
  CURRENT_FRIEND: 'van_current_friend_id_v2'
};

// Generic Loaders with IDB & fallback to initial defaults
export async function loadData<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const val = await get<T>(key);
    if (val !== undefined && val !== null) {
      return val;
    }
    await set(key, defaultValue);
    return defaultValue;
  } catch (err) {
    console.warn(`IDB error loading ${key}, using localStorage/default`, err);
    const local = localStorage.getItem(key);
    if (local) {
      return JSON.parse(local);
    }
    return defaultValue;
  }
}

export async function saveData<T>(key: string, value: T): Promise<void> {
  try {
    await set(key, value);
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`IDB error saving ${key}`, err);
    localStorage.setItem(key, JSON.stringify(value));
  }
}

// Concrete helper getters & setters
export const dbService = {
  getFriends: () => loadData<Friend[]>(KEYS.FRIENDS, DEFAULT_FRIENDS),
  saveFriends: (friends: Friend[]) => saveData(KEYS.FRIENDS, friends),

  getPois: () => loadData<Poi[]>(KEYS.POIS, []),
  savePois: (pois: Poi[]) => saveData(KEYS.POIS, pois),

  getJournal: () => loadData<JournalNote[]>(KEYS.JOURNAL, []),
  saveJournal: (notes: JournalNote[]) => saveData(KEYS.JOURNAL, notes),

  getExpenses: () => loadData<Expense[]>(KEYS.EXPENSES, []),
  saveExpenses: (expenses: Expense[]) => saveData(KEYS.EXPENSES, expenses),

  getPhotos: () => loadData<TripPhoto[]>(KEYS.PHOTOS, []),
  savePhotos: (photos: TripPhoto[]) => saveData(KEYS.PHOTOS, photos),

  getWaypoints: () => loadData<Waypoint[]>(KEYS.WAYPOINTS, []),
  saveWaypoints: (waypoints: Waypoint[]) => saveData(KEYS.WAYPOINTS, waypoints),

  getTracks: () => loadData<GpsTrack[]>(KEYS.TRACKS, []),
  saveTracks: (tracks: GpsTrack[]) => saveData(KEYS.TRACKS, tracks),

  getCurrentFriendId: () => loadData<string>(KEYS.CURRENT_FRIEND, 'adel'),
  saveCurrentFriendId: (id: string) => saveData(KEYS.CURRENT_FRIEND, id)
};

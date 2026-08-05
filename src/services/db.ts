import { get, set } from 'idb-keyval';
import { Friend, GpsTrack, Poi, JournalNote, TripPhoto, Expense, Waypoint } from '../types';

const makeInitialAvatar = (name: string, background: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${background}"/><text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="white">${name.slice(0, 1).toUpperCase()}</text></svg>`)}`;

// Crew accounts only — all journey data starts empty for a clean deploy.
export const DEFAULT_FRIENDS: Friend[] = [
  {
    id: 'adel',
    name: 'Adel',
    avatar: makeInitialAvatar('Adel', '#059669'),
    color: '#059669',
    isCurrentUser: true
  },
  {
    id: 'paul',
    name: 'Paul',
    avatar: makeInitialAvatar('Paul', '#2563eb'),
    color: '#2563eb'
  },
  {
    id: 'yanis',
    name: 'Yanis',
    avatar: makeInitialAvatar('Yanis', '#9333ea'),
    color: '#9333ea'
  }
];

export const DEFAULT_WAYPOINTS: Waypoint[] = [];
export const DEFAULT_POIS: Poi[] = [];
export const DEFAULT_JOURNAL: JournalNote[] = [];
export const DEFAULT_EXPENSES: Expense[] = [
  {
    id: 'exp_demo_1',
    description: 'Plein essence — Total',
    amount: 87.5,
    category: 'carburant',
    date: '2026-08-01',
    paidByFriendId: 'adel',
    splitAmongFriendIds: ['adel', 'paul', 'yanis'],
    splitType: 'equal',
    currency: 'EUR',
  },
  {
    id: 'exp_demo_2',
    description: 'Courses Intermarché',
    amount: 64.2,
    category: 'courses',
    date: '2026-08-02',
    paidByFriendId: 'paul',
    splitAmongFriendIds: ['adel', 'paul', 'yanis'],
    splitType: 'equal',
    currency: 'EUR',
  },
  {
    id: 'exp_demo_3',
    description: 'Péage A71',
    amount: 18.4,
    category: 'peage',
    date: '2026-08-02',
    paidByFriendId: 'yanis',
    splitAmongFriendIds: ['adel', 'paul', 'yanis'],
    splitType: 'equal',
    currency: 'EUR',
  },
  {
    id: 'exp_demo_4',
    description: 'Resto du port — Arcachon',
    amount: 72.0,
    category: 'resto',
    date: '2026-08-03',
    paidByFriendId: 'adel',
    splitAmongFriendIds: ['adel', 'paul', 'yanis'],
    splitType: 'equal',
    currency: 'EUR',
  },
  {
    id: 'exp_demo_5',
    description: 'Location paddle',
    amount: 45.0,
    category: 'activite',
    date: '2026-08-03',
    paidByFriendId: 'paul',
    splitAmongFriendIds: ['paul', 'yanis'],
    splitType: 'equal',
    currency: 'EUR',
    notes: 'Adel n’a pas participé',
  },
  {
    id: 'exp_demo_6',
    description: 'Bouteille gaz + adaptateur',
    amount: 32.9,
    category: 'autre',
    date: '2026-08-04',
    paidByFriendId: 'yanis',
    splitAmongFriendIds: ['adel', 'paul', 'yanis'],
    splitType: 'equal',
    currency: 'EUR',
  },
];
export const DEFAULT_PHOTOS: TripPhoto[] = [];
export const DEFAULT_TRACKS: GpsTrack[] = [];

const DEMO_EXPENSES_SEEDED_KEY = 'van_expenses_demo_seeded_v1';

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

  getExpenses: async () => {
    const expenses = await loadData<Expense[]>(KEYS.EXPENSES, []);
    const demoSeeded = await get<boolean>(DEMO_EXPENSES_SEEDED_KEY);
    if (!expenses.length && !demoSeeded && DEFAULT_EXPENSES.length) {
      await saveData(KEYS.EXPENSES, DEFAULT_EXPENSES);
      await set(DEMO_EXPENSES_SEEDED_KEY, true);
      return DEFAULT_EXPENSES;
    }
    return expenses;
  },
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

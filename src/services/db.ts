import { get, set } from 'idb-keyval';
import { Friend, GpsTrack, Poi, JournalNote, TripPhoto, Expense, Waypoint } from '../types';

const makeInitialAvatar = (name: string, background: string) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${background}"/><text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="white">${name.slice(0, 1).toUpperCase()}</text></svg>`)}`;

// Empty starting crew. All journey data is created by the user.
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

// Initial default waypoints (Annecy to Galibier Road Trip)
export const DEFAULT_WAYPOINTS: Waypoint[] = [
  {
    id: 'w1',
    order: 1,
    title: 'Départ & Bivouac Lac d\'Annecy',
    locationName: 'Talloires-Montmin',
    lat: 45.8364,
    lng: 6.2138,
    date: '2026-08-01',
    status: 'done',
    notes: 'Superbe spot dodo au bord du lac. Eau potable à la fontaine du village.',
    vanSpotType: 'Wild Spot / Parking discret',
    amenities: ['eau', 'ombre', 'gratuit', 'vue_panoramique']
  },
  {
    id: 'w2',
    order: 2,
    title: 'Col de l\'Iseran (2764m)',
    locationName: 'Val d\'Isère',
    lat: 45.4172,
    lng: 7.0308,
    date: '2026-08-02',
    status: 'done',
    notes: 'Passage du col mythique ! Attention au froid la nuit.',
    vanSpotType: 'Bivouac Montagne Altitude',
    amenities: ['vue_panoramique', 'gratuit']
  },
  {
    id: 'w3',
    order: 3,
    title: 'Bivouac Lac du Mont-Cenis',
    locationName: 'Lanslebourg-Mont-Cenis',
    lat: 45.2601,
    lng: 6.9035,
    date: '2026-08-03',
    status: 'active',
    notes: 'Spot magique face aux eaux turquoises du barrage.',
    vanSpotType: 'Aire Camping-Car Nature',
    amenities: ['eau', 'wc', 'gratuit', 'ombre']
  },
  {
    id: 'w4',
    order: 4,
    title: 'Col du Galibier & Lautaret',
    locationName: 'Valloire / Briançon',
    lat: 45.0642,
    lng: 6.4078,
    date: '2026-08-04',
    status: 'upcoming',
    notes: 'Randonnée au glacier d\'Armancette prévue.',
    vanSpotType: 'Parking Rando Sauvage',
    amenities: ['gratuit', 'vue_panoramique']
  }
];

// Initial default POIs
export const DEFAULT_POIS: Poi[] = [
  {
    id: 'p1',
    title: 'Spot Dodo Turquoise Lac Annecy',
    description: 'Bivouac sous les arbres à 50m de la plage sauvage. Très calme.',
    type: 'van_spot',
    lat: 45.8364,
    lng: 6.2138,
    createdAt: '2026-08-01T18:30:00Z',
    createdByFriendId: 'f1',
    photoUrl: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?w=600&auto=format&fit=crop&q=80',
    amenities: ['eau', 'ombre', 'gratuit']
  },
  {
    id: 'p2',
    title: 'Fontaine Eau Potable Source pure',
    description: 'Eau de montagne fraîche et débit rapide.',
    type: 'water',
    lat: 45.8450,
    lng: 6.2050,
    createdAt: '2026-08-01T14:10:00Z',
    createdByFriendId: 'f4',
    amenities: ['eau', 'gratuit']
  },
  {
    id: 'p3',
    title: 'Belvédère des 3 Cols - Panorama 360°',
    description: 'Vue imprenable sur le Mont-Blanc au coucher du soleil.',
    type: 'viewpoint',
    lat: 45.4172,
    lng: 7.0308,
    createdAt: '2026-08-02T19:45:00Z',
    createdByFriendId: 'f2',
    photoUrl: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&auto=format&fit=crop&q=80',
    amenities: ['vue_panoramique', 'gratuit']
  },
  {
    id: 'p4',
    title: 'Bivouac Mont-Cenis Plage',
    description: 'Zone autorisée 19h-9h au bord du lac turquoise.',
    type: 'van_spot',
    lat: 45.2601,
    lng: 6.9035,
    createdAt: '2026-08-03T20:15:00Z',
    createdByFriendId: 'f3',
    photoUrl: 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=600&auto=format&fit=crop&q=80',
    amenities: ['gratuit', 'wc', 'ombre']
  }
];

// Initial default Journal notes
export const DEFAULT_JOURNAL: JournalNote[] = [
  {
    id: 'j1',
    title: 'Premier apéro vanlife face au lac !',
    content: 'On est bien arrivés à Annecy. Le van tourne comme une horloge. Lucas a sorti la planche de charcuterie et Alex a calé les cales sous les roues. Nuit hyper paisible.',
    date: '2026-08-01',
    friendId: 'f2',
    lat: 45.8364,
    lng: 6.2138,
    locationName: 'Lac d\'Annecy',
    photos: ['https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?w=600&auto=format&fit=crop&q=80']
  },
  {
    id: 'j2',
    title: 'Ascension du Col de l\'Iseran 🏔️',
    content: 'Le van a chauffé un peu dans les lacet mais la vue au sommet valait chaque kilomètre ! On a croisé 2 autres t3 de collection. Température fraîche mais soleil radieux.',
    date: '2026-08-02',
    friendId: 'f1',
    lat: 45.4172,
    lng: 7.0308,
    locationName: 'Col de l\'Iseran',
    photos: ['https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=600&auto=format&fit=crop&q=80']
  }
];

// Initial default Expenses (Tricount style)
export const DEFAULT_EXPENSES: Expense[] = [
  {
    id: 'e1',
    description: 'Plein de Diesel Van #1',
    amount: 88.50,
    category: 'carburant',
    date: '2026-08-01',
    paidByFriendId: 'f1',
    splitAmongFriendIds: ['f1', 'f2', 'f3', 'f4']
  },
  {
    id: 'e2',
    description: 'Courses Carrefour & Barbek',
    amount: 64.20,
    category: 'courses',
    date: '2026-08-01',
    paidByFriendId: 'f3',
    splitAmongFriendIds: ['f1', 'f2', 'f3', 'f4']
  },
  {
    id: 'e3',
    description: 'Péage Autoroute A43',
    amount: 22.40,
    category: 'peage',
    date: '2026-08-02',
    paidByFriendId: 'f4',
    splitAmongFriendIds: ['f1', 'f2', 'f3', 'f4']
  },
  {
    id: 'e4',
    description: 'Resto Alpin Fromagerie',
    amount: 95.00,
    category: 'resto',
    date: '2026-08-02',
    paidByFriendId: 'f2',
    splitAmongFriendIds: ['f1', 'f2', 'f3', 'f4']
  }
];

// Initial default Photos
export const DEFAULT_PHOTOS: TripPhoto[] = [
  {
    id: 'ph1',
    url: 'https://images.unsplash.com/photo-1523987355523-c7b5b0dd90a7?w=800&auto=format&fit=crop&q=80',
    caption: 'Notre van garé au bord du lac d\'Annecy 🚐',
    date: '2026-08-01',
    friendId: 'f2',
    lat: 45.8364,
    lng: 6.2138,
    locationName: 'Annecy'
  },
  {
    id: 'ph2',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=800&auto=format&fit=crop&q=80',
    caption: 'Vue grandiose au sommet du Col de l\'Iseran',
    date: '2026-08-02',
    friendId: 'f1',
    lat: 45.4172,
    lng: 7.0308,
    locationName: 'Col de l\'Iseran'
  },
  {
    id: 'ph3',
    url: 'https://images.unsplash.com/photo-1510312305653-8ed496efae75?w=800&auto=format&fit=crop&q=80',
    caption: 'Feu de camp et guirlandes sous le van',
    date: '2026-08-03',
    friendId: 'f3',
    lat: 45.2601,
    lng: 6.9035,
    locationName: 'Lac du Mont-Cenis'
  }
];

// Initial default GPS Track recording
export const DEFAULT_TRACKS: GpsTrack[] = [
  {
    id: 't1',
    title: 'Étape 1 : Annecy -> Val d\'Isère',
    date: '2026-08-01',
    startTime: 1722500000000,
    endTime: 1722510000000,
    distanceKm: 94.2,
    avgSpeedKmH: 52.4,
    maxSpeedKmH: 88.0,
    createdByFriendId: 'f1',
    points: [
      { lat: 45.8992, lng: 6.1294, altitude: 450, speed: 40, timestamp: 1722500000000 },
      { lat: 45.8500, lng: 6.1800, altitude: 470, speed: 65, timestamp: 1722501000000 },
      { lat: 45.8364, lng: 6.2138, altitude: 485, speed: 30, timestamp: 1722502000000 },
      { lat: 45.6500, lng: 6.5000, altitude: 800, speed: 70, timestamp: 1722505000000 },
      { lat: 45.4172, lng: 7.0308, altitude: 2764, speed: 45, timestamp: 1722510000000 }
    ]
  }
];

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

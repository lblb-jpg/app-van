export type PoiType = 'van_spot' | 'camping' | 'water' | 'viewpoint' | 'hike' | 'fuel' | 'food' | 'other';

export interface Friend {
  id: string;
  name: string;
  avatar: string;
  color: string;
  role?: string;
  isCurrentUser?: boolean;
  liveLat?: number;
  liveLng?: number;
  battery?: number;
  lastActive?: string;
  lastActiveAt?: number;
}

export interface GpsPoint {
  lat: number;
  lng: number;
  altitude?: number;
  speed?: number; // km/h
  timestamp: number;
}

export interface GpsTrack {
  id: string;
  title: string;
  date: string;
  startTime: number;
  endTime?: number;
  distanceKm: number;
  avgSpeedKmH: number;
  maxSpeedKmH: number;
  points: GpsPoint[];
  isActive?: boolean;
  createdByFriendId: string;
}

export interface Poi {
  id: string;
  title: string;
  description?: string;
  type: PoiType;
  lat: number;
  lng: number;
  createdAt: string;
  createdByFriendId: string;
  photoUrl?: string;
  amenities?: string[]; // e.g., ['eau', 'ombre', 'gratuit', 'wc', 'wifi']
}

export interface JournalNote {
  id: string;
  title: string;
  content: string;
  date: string;
  friendId: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  photos?: string[];
}

export interface TripPhoto {
  id: string;
  url: string;
  caption?: string;
  date: string;
  friendId: string;
  lat?: number;
  lng?: number;
  locationName?: string;
  mediaType?: 'photo' | 'video';
}

export type ExpenseCategory = 'carburant' | 'peage' | 'courses' | 'resto' | 'activite' | 'autre';

export type SplitType = 'equal' | 'shares' | 'custom';

export interface SplitDetail {
  friendId: string;
  shares?: number;
  amount?: number;
}

export interface Expense {
  id: string;
  description: string;
  amount: number;
  category: ExpenseCategory;
  date: string;
  paidByFriendId: string;
  splitAmongFriendIds: string[];
  splitType?: SplitType;
  splitDetails?: SplitDetail[];
  currency?: string;
  notes?: string;
}

export interface DebtSettlement {
  fromFriendId: string;
  toFriendId: string;
  amount: number;
}

export interface Waypoint {
  id: string;
  order: number;
  title: string;
  locationName: string;
  lat: number;
  lng: number;
  date?: string;
  status: 'done' | 'active' | 'upcoming';
  notes?: string;
  vanSpotType?: string;
  amenities?: string[];
  photos?: string[];
}

export interface VanSleepSpot {
  id: string;
  osmType: 'node' | 'way' | 'relation';
  osmId: number;
  name: string;
  type: 'motorhome_stopover' | 'caravan_site' | 'camp_site' | 'rest_area' | 'picnic_site' | 'van_parking' | 'parking';
  label: string;
  confidence: 'official' | 'likely' | 'verify';
  lat: number;
  lng: number;
  distanceKm: number;
  address?: string;
  amenities: string[];
  fee?: string;
  feeAmount?: string;
  openingHours?: string;
  capacity?: string;
  maxstay?: string;
  access?: string;
  surface?: string;
  lit?: boolean;
  reservation?: string;
  website?: string;
  phone?: string;
  operator?: string;
  description?: string;
  sourceUrl: string;
  navigationUrl: string;
}

export interface VanSleepSearchResult {
  query: string;
  place: { name: string; lat: number; lng: number; type: string };
  radiusKm: number;
  count: number;
  spots: VanSleepSpot[];
  attribution: string;
  notice: string;
}

export interface FrancePlace {
  id: string;
  name: string;
  label: string;
  postalCode: string;
  department: string;
  region: string;
  population: number;
  lat: number;
  lng: number;
}

export type TabType = 'map' | 'sleep' | 'waypoints' | 'journal' | 'budget' | 'profile';

import type { VanSleepSpot } from '../types';

export type OsmTags = Record<string, string>;

export type ClassifiedSpot = {
  type: VanSleepSpot['type'];
  label: string;
  confidence: VanSleepSpot['confidence'];
  baseScore: number;
};

const PRIVATE_ACCESS = new Set(['private', 'no', 'military', 'forbidden']);

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function yesNo(value?: string) {
  if (!value) return undefined;
  if (['yes', 'designated', 'permissive'].includes(value)) return true;
  if (['no', 'private'].includes(value)) return false;
  return undefined;
}

/** Build an Overpass QL focused on places where vans can actually overnight. */
export function buildVanSpotOverpassQuery(lat: number, lng: number, radiusMeters: number) {
  const around = `around:${radiusMeters},${lat},${lng}`;
  return `[out:json][timeout:28];
(
  nwr(${around})["amenity"="motorhome_stopover"];
  nwr(${around})["tourism"="caravan_site"];
  nwr(${around})["tourism"="camp_site"]["caravans"!="no"]["tents"!="only"];
  nwr(${around})["amenity"="parking"]["motorhome"~"^(yes|designated)$"];
  nwr(${around})["amenity"="parking"]["overnight"="yes"];
  nwr(${around})["amenity"="parking"]["capacity:motorhome"];
  nwr(${around})["amenity"="parking"]["caravans"~"^(yes|designated)$"];
);
out center tags;`;
}

export function classifyVanSpot(tags: OsmTags): ClassifiedSpot | null {
  // Hard rejects — not usable for overnighting a van.
  if (PRIVATE_ACCESS.has(tags.access || '')) return null;
  if (tags.motorhome === 'no' || tags.caravan === 'no' || tags.overnight === 'no') return null;
  if (tags.tourism === 'picnic_site' || tags.highway === 'rest_area') return null;

  if (tags.amenity === 'motorhome_stopover') {
    return { type: 'motorhome_stopover', label: 'Aire camping-car', confidence: 'official', baseScore: 1000 };
  }
  if (tags.tourism === 'caravan_site') {
    return { type: 'caravan_site', label: 'Aire / camping-car', confidence: 'official', baseScore: 960 };
  }
  if (tags.tourism === 'camp_site') {
    const welcomesVans =
      tags.caravans === 'yes' ||
      tags.motorhome === 'yes' ||
      tags.motorhome === 'designated' ||
      tags['capacity:caravans'] != null ||
      tags['capacity:motorhome'] != null;
    return {
      type: 'camp_site',
      label: welcomesVans ? 'Camping van / caravane' : 'Camping',
      confidence: welcomesVans ? 'official' : 'likely',
      baseScore: welcomesVans ? 880 : 720,
    };
  }

  const motorhomeOk = tags.motorhome === 'yes' || tags.motorhome === 'designated';
  const overnightOk = tags.overnight === 'yes';
  const caravanOk = tags.caravans === 'yes' || tags.caravans === 'designated';
  const capacityMotorhome = Boolean(tags['capacity:motorhome']);

  if (tags.amenity === 'parking' && (motorhomeOk || overnightOk || caravanOk || capacityMotorhome)) {
    if (overnightOk || motorhomeOk) {
      return {
        type: 'van_parking',
        label: overnightOk ? 'Parking nuit autorisée' : 'Parking van signalé',
        confidence: 'likely',
        baseScore: overnightOk ? 820 : 780,
      };
    }
    return {
      type: 'van_parking',
      label: 'Parking caravane / van',
      confidence: 'likely',
      baseScore: 740,
    };
  }

  return null;
}

export function extractAmenities(tags: OsmTags): string[] {
  return [
    tags.drinking_water === 'yes' || tags.water_point === 'yes' ? 'Eau potable' : null,
    tags.toilets === 'yes' ? 'Toilettes' : null,
    tags.shower === 'yes' ? 'Douches' : null,
    tags.electricity === 'yes' || tags.power_supply === 'yes' ? 'Électricité' : null,
    tags.sanitary_dump_station === 'yes' || tags.amenity === 'sanitary_dump_station' ? 'Vidange' : null,
    tags.waste_disposal === 'yes' || tags.recycling === 'yes' ? 'Poubelles' : null,
    tags.internet_access === 'wlan' || tags.internet_access === 'yes' ? 'Wi-Fi' : null,
    tags.fee === 'no' ? 'Gratuit' : null,
  ].filter((item): item is string => !!item);
}

function amenityBonus(amenities: string[], tags: OsmTags) {
  let bonus = 0;
  if (amenities.includes('Eau potable')) bonus += 45;
  if (amenities.includes('Vidange')) bonus += 55;
  if (amenities.includes('Électricité')) bonus += 30;
  if (amenities.includes('Douches')) bonus += 28;
  if (amenities.includes('Toilettes')) bonus += 18;
  if (amenities.includes('Wi-Fi')) bonus += 8;
  if (amenities.includes('Gratuit') || tags.fee === 'no') bonus += 70;
  if (tags.name || tags['name:fr']) bonus += 30;
  if (tags.website || tags.phone) bonus += 12;
  if (tags.maxstay) bonus += 10;
  if (tags.access === 'customers') bonus -= 80;
  if (tags.fee === 'yes') bonus -= 15;
  return bonus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

type Ranked = { spot: VanSleepSpot; score: number };

/** Map raw Overpass elements to ranked overnight spots. */
export function mapOverpassToSpots(
  elements: unknown[],
  originLat: number,
  originLng: number,
  maxResults = 60
): VanSleepSpot[] {
  const ranked: Ranked[] = [];

  for (const [index, element] of elements.entries()) {
    if (!isRecord(element)) continue;
    const tags = (isRecord(element.tags) ? element.tags : {}) as OsmTags;
    const center = isRecord(element.center) ? element.center : null;
    const spotLat = Number(element.lat ?? center?.lat);
    const spotLng = Number(element.lon ?? center?.lon);
    if (!Number.isFinite(spotLat) || !Number.isFinite(spotLng)) continue;

    const classification = classifyVanSpot(tags);
    if (!classification) continue;

    const distance = distanceKm(originLat, originLng, spotLat, spotLng);
    const amenities = extractAmenities(tags);
    // Strong distance weight: a close aire beats a far camping.
    const score =
      classification.baseScore + amenityBonus(amenities, tags) - distance * 22;

    const osmType = element.type === 'way' || element.type === 'relation' ? element.type : 'node';
    const osmId = Number(element.id) || index;
    const address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:place'], tags['addr:city']]
      .filter(Boolean)
      .join(' ');

    ranked.push({
      score,
      spot: {
        id: `${osmType}-${osmId}`,
        osmType,
        osmId,
        name: tags.name || tags['name:fr'] || classification.label,
        type: classification.type,
        label: classification.label,
        confidence: classification.confidence,
        lat: spotLat,
        lng: spotLng,
        distanceKm: Number(distance.toFixed(1)),
        address: address || undefined,
        amenities,
        fee: tags.fee,
        feeAmount: tags.charge,
        openingHours: tags.opening_hours,
        capacity: tags.capacity || tags['capacity:caravans'] || tags['capacity:motorhome'],
        maxstay: tags.maxstay,
        access: tags.access,
        surface: tags.surface,
        lit: yesNo(tags.lit),
        reservation: tags.reservation,
        website: tags.website || tags['contact:website'],
        phone: tags.phone || tags['contact:phone'],
        operator: tags.operator,
        description: tags.description || tags.note,
        sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
        navigationUrl: `https://www.google.com/maps/dir/?api=1&destination=${spotLat},${spotLng}`,
      },
    });
  }

  // Deduplicate near-identical pins (node + surrounding way, etc.).
  ranked.sort((a, b) => b.score - a.score || a.spot.distanceKm - b.spot.distanceKm);
  const kept: Ranked[] = [];
  for (const candidate of ranked) {
    const duplicate = kept.some(
      (existing) =>
        distanceKm(existing.spot.lat, existing.spot.lng, candidate.spot.lat, candidate.spot.lng) < 0.06
    );
    if (!duplicate) kept.push(candidate);
  }

  return kept.slice(0, maxResults).map(({ spot }) => spot);
}

export function shortPlaceName(raw: string, fallback: string) {
  const cleaned = raw.split(',')[0]?.trim();
  return cleaned || fallback;
}

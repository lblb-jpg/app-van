import React from 'react';
import {
  X,
  MapPin,
  Navigation,
  ExternalLink,
  Clock3,
  Battery,
  Mountain,
  Gauge,
  Calendar,
  User,
  Phone,
  Globe,
  BookOpen,
  Camera,
  Milestone,
  Sparkles,
} from 'lucide-react';
import type {
  Friend,
  GpsPoint,
  GpsTrack,
  JournalNote,
  Poi,
  PoiType,
  TripPhoto,
  VanSleepSpot,
  Waypoint,
} from '../types';
import { getSleepSpotEmoji, sleepSpotBorderColor } from '../lib/mapCoords';

export type MapSelection =
  | { type: 'poi'; id: string }
  | { type: 'waypoint'; id: string }
  | { type: 'sleepSpot'; id: string }
  | { type: 'friend'; id: string }
  | { type: 'photo'; id: string }
  | { type: 'journal'; id: string }
  | { type: 'user' }
  | { type: 'track'; id: string };

interface MapInfoPanelProps {
  selection: MapSelection;
  onClose: () => void;
  pois: Poi[];
  waypoints: Waypoint[];
  sleepSpots: VanSleepSpot[];
  friends: Friend[];
  photos: TripPhoto[];
  journal: JournalNote[];
  tracks: GpsTrack[];
  userLocation: GpsPoint | null;
  currentFriendId: string;
}

const AMENITY_LABELS: Record<string, string> = {
  eau: '🚰 Eau',
  ombre: '🌲 Ombre',
  gratuit: '🆓 Gratuit',
  wc: '🚽 WC',
  douche: '🚿 Douche',
  vue_panoramique: '🏔️ Vue',
  wifi: '📶 WiFi',
  elec: '⚡ Électricité',
};

function amenityLabel(id: string) {
  return AMENITY_LABELS[id] || id.replace(/_/g, ' ');
}

function detailValue(value?: string | boolean) {
  if (value === undefined || value === null) return null;
  if (value === true || value === 'yes') return 'Oui';
  if (value === false || value === 'no') return 'Non';
  return String(value);
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function formatTimestamp(ts: number) {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function getPoiConfig(type: PoiType) {
  switch (type) {
    case 'van_spot':
      return { emoji: '🚐', bg: '#059669', label: 'Spot Van' };
    case 'water':
      return { emoji: '🚰', bg: '#0284c7', label: "Point d'eau" };
    case 'viewpoint':
      return { emoji: '📸', bg: '#d97706', label: 'Panorama' };
    case 'camping':
      return { emoji: '⛺', bg: '#7c3aed', label: 'Camping' };
    case 'fuel':
      return { emoji: '⛽', bg: '#dc2626', label: 'Station' };
    case 'hike':
      return { emoji: '🥾', bg: '#16a34a', label: 'Randonnée' };
    case 'food':
      return { emoji: '🍽️', bg: '#ea580c', label: 'Restauration' };
    default:
      return { emoji: '📍', bg: '#475569', label: "Point d'intérêt" };
  }
}

function NavButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="map-info-panel__nav-btn"
    >
      <Navigation className="h-4 w-4" />
      {label}
    </a>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="map-info-panel__stat">
      <span className="map-info-panel__stat-icon">{icon}</span>
      <div>
        <span className="map-info-panel__stat-label">{label}</span>
        <strong className="map-info-panel__stat-value">{value}</strong>
      </div>
    </div>
  );
}

function ChipRow({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="map-info-panel__chips">
      {items.map((item) => (
        <span key={item} className="map-info-panel__chip">{item}</span>
      ))}
    </div>
  );
}

function DetailGrid({ rows }: { rows: { icon: React.ReactNode; label: string; value: string }[] }) {
  const valid = rows.filter((r) => r.value);
  if (!valid.length) return null;
  return (
    <div className="map-info-panel__grid">
      {valid.map((row) => (
        <div key={row.label} className="map-info-panel__grid-item">
          <span className="map-info-panel__grid-icon">{row.icon}</span>
          <div>
            <span className="map-info-panel__grid-label">{row.label}</span>
            <span className="map-info-panel__grid-value">{row.value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export const MapInfoPanel: React.FC<MapInfoPanelProps> = ({
  selection,
  onClose,
  pois,
  waypoints,
  sleepSpots,
  friends,
  photos,
  journal,
  tracks,
  userLocation,
  currentFriendId,
}) => {
  const renderContent = () => {
    switch (selection.type) {
      case 'poi': {
        const poi = pois.find((p) => p.id === selection.id);
        if (!poi) return null;
        const cfg = getPoiConfig(poi.type);
        const creator = friends.find((f) => f.id === poi.createdByFriendId);
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lng}`;
        return (
          <>
            <div className="map-info-panel__hero" style={{ '--hero-color': cfg.bg } as React.CSSProperties}>
              <span className="map-info-panel__emoji">{cfg.emoji}</span>
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: cfg.bg }}>{cfg.label}</span>
                <h2>{poi.title}</h2>
                {poi.description && <p>{poi.description}</p>}
              </div>
            </div>
            {poi.photoUrl && (
              <img src={poi.photoUrl} alt="" className="map-info-panel__photo" />
            )}
            <ChipRow items={(poi.amenities || []).map(amenityLabel)} />
            <DetailGrid rows={[
              { icon: <MapPin className="h-3.5 w-3.5" />, label: 'Coordonnées', value: `${poi.lat.toFixed(5)}, ${poi.lng.toFixed(5)}` },
              { icon: <Calendar className="h-3.5 w-3.5" />, label: 'Ajouté le', value: formatDate(poi.createdAt) },
              { icon: <User className="h-3.5 w-3.5" />, label: 'Par', value: creator?.name || 'Équipage' },
            ]} />
            <NavButton href={navUrl} label="Y aller" />
          </>
        );
      }

      case 'waypoint': {
        const wp = waypoints.find((w) => w.id === selection.id);
        if (!wp) return null;
        const statusLabel = wp.status === 'done' ? 'Terminée' : wp.status === 'active' ? 'En cours' : 'À venir';
        const statusColor = wp.status === 'done' ? '#64748b' : wp.status === 'active' ? '#eb6c32' : '#059669';
        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${wp.lat},${wp.lng}`;
        const notes = wp.notes?.replace(/\s*·?\s*Source OpenStreetMap\s*:\s*https?:\/\/\S+/gi, '').trim();
        return (
          <>
            <div className="map-info-panel__hero map-info-panel__hero--waypoint">
              <span className="map-info-panel__step-num">{wp.order}</span>
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: statusColor }}>{statusLabel}</span>
                <h2>{wp.title}</h2>
                <p><MapPin className="inline h-3 w-3" /> {wp.locationName}</p>
              </div>
            </div>
            {wp.photos && wp.photos.length > 0 && (
              <div className="map-info-panel__photo-row">
                {wp.photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="map-info-panel__photo-thumb" />
                ))}
              </div>
            )}
            <ChipRow items={[
              ...(wp.vanSpotType ? [wp.vanSpotType] : []),
              ...(wp.amenities || []).map(amenityLabel),
            ]} />
            <DetailGrid rows={[
              { icon: <Milestone className="h-3.5 w-3.5" />, label: 'Étape', value: `#${wp.order}` },
              { icon: <Calendar className="h-3.5 w-3.5" />, label: 'Date', value: wp.date ? formatDate(wp.date) : '' },
              { icon: <MapPin className="h-3.5 w-3.5" />, label: 'Coordonnées', value: `${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}` },
            ]} />
            {notes && <p className="map-info-panel__note">{notes}</p>}
            <NavButton href={navUrl} label="Y aller" />
          </>
        );
      }

      case 'sleepSpot': {
        const spot = sleepSpots.find((s) => s.id === selection.id);
        if (!spot) return null;
        const borderColor = sleepSpotBorderColor(spot.confidence);
        const emoji = getSleepSpotEmoji(spot);
        const confidenceLabel = spot.confidence === 'official' ? 'Officiel' : spot.confidence === 'likely' ? 'Probable' : 'À vérifier';
        return (
          <>
            <div className="map-info-panel__hero" style={{ '--hero-color': borderColor } as React.CSSProperties}>
              <span className="map-info-panel__emoji">{emoji}</span>
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: borderColor }}>{spot.label}</span>
                <h2>{spot.name}</h2>
                <p>{spot.distanceKm} km · {confidenceLabel}</p>
              </div>
            </div>
            {spot.address && <p className="map-info-panel__address"><MapPin className="inline h-3.5 w-3.5" /> {spot.address}</p>}
            <ChipRow items={spot.amenities} />
            <DetailGrid rows={[
              { icon: <span className="text-xs font-bold">€</span>, label: 'Tarif', value: spot.fee === 'no' ? 'Gratuit' : spot.feeAmount || (spot.fee ? 'Payant' : '') },
              { icon: <Clock3 className="h-3.5 w-3.5" />, label: 'Horaires', value: spot.openingHours || '' },
              { icon: <Sparkles className="h-3.5 w-3.5" />, label: 'Capacité', value: spot.capacity || '' },
              { icon: <Clock3 className="h-3.5 w-3.5" />, label: 'Durée max.', value: spot.maxstay || '' },
              { icon: <MapPin className="h-3.5 w-3.5" />, label: 'Accès', value: detailValue(spot.access) || '' },
              { icon: <Mountain className="h-3.5 w-3.5" />, label: 'Sol', value: spot.surface || '' },
              { icon: <Sparkles className="h-3.5 w-3.5" />, label: 'Éclairé', value: spot.lit != null ? (spot.lit ? 'Oui' : 'Non') : '' },
              { icon: <User className="h-3.5 w-3.5" />, label: 'Opérateur', value: spot.operator || '' },
            ]} />
            {spot.description && <p className="map-info-panel__note">{spot.description}</p>}
            <div className="map-info-panel__links">
              <NavButton href={spot.navigationUrl} label="Y aller" />
              {spot.website && (
                <a href={spot.website} target="_blank" rel="noreferrer" className="map-info-panel__link">
                  <Globe className="h-3.5 w-3.5" /> Site web
                </a>
              )}
              {spot.phone && (
                <a href={`tel:${spot.phone}`} className="map-info-panel__link">
                  <Phone className="h-3.5 w-3.5" /> {spot.phone}
                </a>
              )}
              <a href={spot.sourceUrl} target="_blank" rel="noreferrer" className="map-info-panel__link map-info-panel__link--muted">
                <ExternalLink className="h-3.5 w-3.5" /> OpenStreetMap
              </a>
            </div>
          </>
        );
      }

      case 'friend': {
        const friend = friends.find((f) => f.id === selection.id);
        if (!friend) return null;
        const isCurrentUser = friend.id === currentFriendId;
        const isLive = friend.liveLat != null && friend.liveLng != null;
        const navUrl = isLive
          ? `https://www.google.com/maps/dir/?api=1&destination=${friend.liveLat},${friend.liveLng}`
          : '';
        return (
          <>
            <div className="map-info-panel__hero map-info-panel__hero--friend" style={{ '--hero-color': friend.color } as React.CSSProperties}>
              <img src={friend.avatar} alt="" className="map-info-panel__avatar" />
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: friend.color }}>
                  {isCurrentUser ? 'Vous' : 'Équipier'}
                </span>
                <h2>{friend.name}</h2>
                <p>{friend.role || 'Membre de l\'équipage'}</p>
              </div>
            </div>
            <div className="map-info-panel__stats-row">
              <Stat icon={<Battery className="h-4 w-4" />} label="Batterie" value={`${Math.max(0, Math.min(100, friend.battery ?? 85))}%`} />
              <Stat icon={<span className={`map-info-panel__live-dot ${isLive ? 'is-live' : ''}`} />} label="Statut" value={isLive ? (friend.lastActive || 'En direct') : 'Hors ligne'} />
              {isLive && friend.liveLat != null && (
                <Stat icon={<MapPin className="h-4 w-4" />} label="Position" value={`${friend.liveLat.toFixed(4)}, ${friend.liveLng!.toFixed(4)}`} />
              )}
            </div>
            {navUrl && !isCurrentUser && <NavButton href={navUrl} label="Rejoindre sur la carte" />}
          </>
        );
      }

      case 'photo': {
        const photo = photos.find((p) => p.id === selection.id);
        if (!photo) return null;
        const author = friends.find((f) => f.id === photo.friendId);
        const navUrl = photo.lat && photo.lng
          ? `https://www.google.com/maps/dir/?api=1&destination=${photo.lat},${photo.lng}`
          : '';
        return (
          <>
            <img src={photo.url} alt="" className="map-info-panel__photo map-info-panel__photo--large" />
            <div className="map-info-panel__hero-text map-info-panel__hero-text--compact">
              <span className="map-info-panel__badge" style={{ background: '#475569' }}>
                <Camera className="inline h-3 w-3" /> Photo
              </span>
              <h2>{photo.caption || 'Photo souvenir'}</h2>
            </div>
            <DetailGrid rows={[
              { icon: <Calendar className="h-3.5 w-3.5" />, label: 'Date', value: formatDate(photo.date) },
              { icon: <User className="h-3.5 w-3.5" />, label: 'Par', value: author?.name || 'Équipage' },
              { icon: <MapPin className="h-3.5 w-3.5" />, label: 'Lieu', value: photo.locationName || '' },
            ]} />
            {navUrl && <NavButton href={navUrl} label="Y aller" />}
          </>
        );
      }

      case 'journal': {
        const note = journal.find((n) => n.id === selection.id);
        if (!note) return null;
        const author = friends.find((f) => f.id === note.friendId);
        const navUrl = note.lat && note.lng
          ? `https://www.google.com/maps/dir/?api=1&destination=${note.lat},${note.lng}`
          : '';
        return (
          <>
            <div className="map-info-panel__hero map-info-panel__hero--journal">
              <BookOpen className="map-info-panel__journal-icon" />
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: '#7c3aed' }}>Journal</span>
                <h2>{note.title}</h2>
                <p>{formatDate(note.date)} · {author?.name || 'Équipage'}</p>
              </div>
            </div>
            <p className="map-info-panel__note map-info-panel__note--body">{note.content}</p>
            {note.locationName && (
              <p className="map-info-panel__address"><MapPin className="inline h-3.5 w-3.5" /> {note.locationName}</p>
            )}
            {note.photos && note.photos.length > 0 && (
              <div className="map-info-panel__photo-row">
                {note.photos.map((url, i) => (
                  <img key={i} src={url} alt="" className="map-info-panel__photo-thumb" />
                ))}
              </div>
            )}
            {navUrl && <NavButton href={navUrl} label="Y aller" />}
          </>
        );
      }

      case 'user': {
        if (!userLocation) return null;
        return (
          <>
            <div className="map-info-panel__hero map-info-panel__hero--user">
              <span className="map-info-panel__emoji">🚐</span>
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: '#059669' }}>Position GPS</span>
                <h2>Votre Van</h2>
                <p>Mise à jour {formatTimestamp(userLocation.timestamp)}</p>
              </div>
            </div>
            <div className="map-info-panel__stats-row">
              <Stat icon={<MapPin className="h-4 w-4" />} label="Coordonnées" value={`${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`} />
              {userLocation.altitude != null && (
                <Stat icon={<Mountain className="h-4 w-4" />} label="Altitude" value={`${userLocation.altitude} m`} />
              )}
              {userLocation.speed != null && (
                <Stat icon={<Gauge className="h-4 w-4" />} label="Vitesse" value={`${Math.round(userLocation.speed)} km/h`} />
              )}
            </div>
          </>
        );
      }

      case 'track': {
        const track = tracks.find((t) => t.id === selection.id);
        if (!track) return null;
        return (
          <>
            <div className="map-info-panel__hero map-info-panel__hero--track">
              <span className="map-info-panel__emoji">🛤️</span>
              <div className="map-info-panel__hero-text">
                <span className="map-info-panel__badge" style={{ background: '#64748b' }}>Trace GPX</span>
                <h2>{track.title}</h2>
                <p>{formatDate(track.date)}</p>
              </div>
            </div>
            <div className="map-info-panel__stats-row">
              <Stat icon={<MapPin className="h-4 w-4" />} label="Distance" value={`${track.distanceKm} km`} />
              <Stat icon={<Gauge className="h-4 w-4" />} label="Vitesse moy." value={`${track.avgSpeedKmH} km/h`} />
              <Stat icon={<Gauge className="h-4 w-4" />} label="Vitesse max." value={`${track.maxSpeedKmH} km/h`} />
              <Stat icon={<Clock3 className="h-4 w-4" />} label="Points" value={`${track.points.length}`} />
            </div>
          </>
        );
      }

      default:
        return null;
    }
  };

  const content = renderContent();
  if (!content) return null;

  return (
    <div className="map-info-panel" role="dialog" aria-label="Détails du point sélectionné">
      <div className="map-info-panel__handle" aria-hidden />
      <button type="button" onClick={onClose} className="map-info-panel__close" aria-label="Fermer">
        <X className="h-4 w-4" />
      </button>
      <div className="map-info-panel__scroll">
        {content}
      </div>
    </div>
  );
};

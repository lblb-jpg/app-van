import React, { useRef, useState } from 'react';
import {
  Milestone,
  Plus,
  MapPin,
  ChevronUp,
  ChevronDown,
  Trash2,
  Navigation,
  X,
  Camera,
  ImagePlus,
  LocateFixed,
  LoaderCircle,
} from 'lucide-react';
import { GpsPoint, Waypoint } from '../types';
import { getWaypointEmoji, hasValidCoords } from '../lib/mapCoords';
import { SimpleFormModal } from './SimpleFormModal';
import {
  CompactFormField,
  CompactFormHero,
  CompactFormRoot,
  CompactFormSection,
  CompactFormTextInput,
  FormModalFooter,
} from './CompactFormLayout';
import { PlaceAutocompleteInput } from './PlaceAutocompleteInput';
import { getCurrentPositionPrecise, reverseGeocodeCity } from '../services/geolocation';

const withoutSource = (notes?: string) =>
  notes
    ?.replace(/\s*·?\s*Source OpenStreetMap\s*:\s*https?:\/\/\S+/gi, '')
    .trim() || '';

const MAX_WAYPOINT_PHOTOS = 6;

async function fileToWaypointPhotoDataUrl(file: File, maxSize = 1280): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image illisible'));
      img.src = objectUrl;
    });

    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas indisponible');
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.84);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

interface WaypointsManagerProps {
  waypoints: Waypoint[];
  userLocation?: GpsPoint | null;
  onAddWaypoint: (newWp: Omit<Waypoint, 'id'>) => void | Promise<void>;
  onUpdateWaypointStatus: (id: string, status: 'done' | 'active' | 'upcoming') => void;
  onReorderWaypoint: (id: string, direction: 'up' | 'down') => void;
  onDeleteWaypoint: (id: string) => void;
  onSelectOnMap: (lat: number, lng: number, label?: string, emoji?: string) => void;
}

export const WaypointsManager: React.FC<WaypointsManagerProps> = ({
  waypoints,
  userLocation = null,
  onAddWaypoint,
  onUpdateWaypointStatus,
  onReorderWaypoint,
  onDeleteWaypoint,
  onSelectOnMap
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedWaypointId, setExpandedWaypointId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [locationName, setLocationName] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const resetAddForm = () => {
    setTitle('');
    setLocationName('');
    setNotes('');
    setPhotos([]);
    setPhotoError('');
    setFormError('');
    setLat('');
    setLng('');
    setLocating(false);
  };

  const openAddModal = () => {
    resetAddForm();
    setShowAddModal(true);
  };

  const closeAddModal = () => {
    if (saving) return;
    resetAddForm();
    setShowAddModal(false);
  };

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const hasValidPlaceCoords =
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    !(parsedLat === 0 && parsedLng === 0);
  const canSubmitWaypoint = Boolean(title.trim() && locationName.trim() && hasValidPlaceCoords);

  const useCurrentPlace = async () => {
    if (locating) return;
    setLocating(true);
    setFormError('');
    try {
      let fixLat = userLocation?.lat;
      let fixLng = userLocation?.lng;

      if (
        fixLat == null ||
        fixLng == null ||
        !Number.isFinite(fixLat) ||
        !Number.isFinite(fixLng)
      ) {
        const position = await getCurrentPositionPrecise();
        fixLat = position.coords.latitude;
        fixLng = position.coords.longitude;
      }

      const place = await reverseGeocodeCity(fixLat, fixLng);
      if (!place) {
        setFormError('Impossible de trouver la ville à cette position.');
        return;
      }

      setLocationName(place.name);
      setLat(String(place.lat));
      setLng(String(place.lng));
      setFormError('');
    } catch (err) {
      const msg =
        err instanceof GeolocationPositionError
          ? err.code === err.PERMISSION_DENIED
            ? 'Autorise la localisation pour utiliser ta position.'
            : 'GPS indisponible pour le moment.'
          : err instanceof Error
            ? err.message
            : 'Impossible de récupérer ta position.';
      setFormError(msg);
    } finally {
      setLocating(false);
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!title.trim() || !locationName.trim()) {
      setFormError('Remplis le nom et le lieu.');
      return;
    }
    if (!hasValidPlaceCoords) {
      setFormError('Choisis une suggestion de lieu (coords requises).');
      return;
    }

    setSaving(true);
    try {
      await onAddWaypoint({
        order: waypoints.length + 1,
        title: title.trim(),
        locationName: locationName.trim(),
        lat: parsedLat,
        lng: parsedLng,
        status: 'upcoming',
        notes: notes.trim() || undefined,
        photos: photos.length ? photos : undefined,
      });
      resetAddForm();
      setShowAddModal(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Impossible d’ajouter l’étape.');
    } finally {
      setSaving(false);
    }
  };

  const handlePhotosSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []) as File[];
    e.target.value = '';
    if (!files.length) return;

    const remaining = MAX_WAYPOINT_PHOTOS - photos.length;
    if (remaining <= 0) {
      setPhotoError(`Maximum ${MAX_WAYPOINT_PHOTOS} photos par étape.`);
      return;
    }

    const next: string[] = [];
    try {
      for (const file of files.slice(0, remaining)) {
        if (!file.type.startsWith('image/')) continue;
        next.push(await fileToWaypointPhotoDataUrl(file));
      }
      if (!next.length) {
        setPhotoError('Choisis des images (JPG, PNG…).');
        return;
      }
      setPhotos((prev) => [...prev, ...next]);
      setPhotoError(files.length > remaining ? `Seules ${remaining} photo(s) ajoutée(s).` : '');
    } catch {
      setPhotoError('Impossible de lire une des photos.');
    }
  };

  const sortedWaypoints = [...waypoints].sort((a, b) => a.order - b.order);
  const completedCount = sortedWaypoints.filter((wp) => wp.status === 'done').length;
  const activeWaypoint = sortedWaypoints.find((wp) => wp.status === 'active');

  return (
    <div className="page-pad space-y-3 sm:space-y-4">
      {/* Trip overview */}
      <div className="relative overflow-hidden bg-zinc-950 rounded-[1.75rem] p-4 shadow-lg shadow-zinc-950/10 text-white sm:rounded-[2rem] sm:p-5">
        <div className="absolute -right-8 -top-10 w-40 h-40 rounded-full bg-emerald-500/15 blur-2xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] font-extrabold tracking-[0.16em] text-emerald-300 uppercase">Itinéraire</span>
            <h2 className="font-extrabold text-lg sm:text-xl tracking-tight mt-1 flex items-center gap-2">
              <Milestone className="w-5 h-5 shrink-0 text-emerald-400" /> Étapes & arrêts
            </h2>
            <p className="text-xs text-zinc-300 font-medium mt-1">
              L’essentiel de chaque spot, au bon moment.
            </p>
          </div>
        <button
          type="button"
          onClick={openAddModal}
          className="shrink-0 min-h-11 px-3.5 py-2.5 rounded-2xl bg-white hover:bg-emerald-50 text-zinc-900 font-bold text-xs shadow-sm transition-all flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4 text-emerald-600" /> Ajouter
        </button>
        </div>
        <div className="relative mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-white/10 border border-white/10 px-3 py-2">
            <span className="block text-[10px] font-bold text-zinc-400 uppercase">Étapes</span>
            <span className="text-lg font-extrabold">{sortedWaypoints.length}</span>
          </div>
          <div className="rounded-2xl bg-white/10 border border-white/10 px-3 py-2">
            <span className="block text-[10px] font-bold text-zinc-400 uppercase">Visitées</span>
            <span className="text-lg font-extrabold">{completedCount}</span>
          </div>
          <div className="rounded-2xl bg-emerald-400/15 border border-emerald-300/20 px-3 py-2 min-w-0">
            <span className="block text-[10px] font-bold text-emerald-200 uppercase">Maintenant</span>
            <span className="block truncate text-xs font-extrabold text-white mt-1">{activeWaypoint ? `#${activeWaypoint.order}` : 'À venir'}</span>
          </div>
        </div>
      </div>

      {/* Waypoints Timeline List */}
      <div className="waypoint-list">
        {sortedWaypoints.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-8 text-center text-zinc-400 border border-zinc-200 text-xs font-medium">
            Aucune étape configurée. Ajoutez votre première étape pour démarrer l’itinéraire.
          </div>
        ) : (
          sortedWaypoints.map((wp, index) => {
            const isDone = wp.status === 'done';
            const isActive = wp.status === 'active';
            const isExpanded = expandedWaypointId === wp.id || (expandedWaypointId === null && isActive);
            const visibleNotes = withoutSource(wp.notes);
            const emoji = getWaypointEmoji(wp);
            const cardTone = isActive ? 'active' : isDone ? 'done' : 'upcoming';

            return (
              <div
                key={wp.id}
                className={`waypoint-card waypoint-card--${cardTone}`}
              >
                <div className="waypoint-card__accent" aria-hidden />

                <div className="waypoint-card__inner">
                  <div className="waypoint-card__badge" aria-hidden>
                    <span className="waypoint-card__emoji">{emoji}</span>
                    <span className="waypoint-card__order">#{wp.order}</span>
                  </div>

                  <div className="waypoint-card__main">
                    <div className="waypoint-card__head">
                      <h3 className="waypoint-card__title">{wp.title}</h3>
                    </div>

                    <p className="waypoint-card__location">
                      <MapPin className="w-3 h-3 shrink-0 text-zinc-400" />
                      <span>{wp.locationName}</span>
                    </p>

                    {(wp.vanSpotType || (wp.photos && wp.photos.length > 0)) && (
                      <div className="waypoint-card__meta">
                        {wp.vanSpotType && (
                          <span className="waypoint-card__tag">🚐 {wp.vanSpotType}</span>
                        )}
                        {wp.photos && wp.photos.length > 0 && (
                          <span className="waypoint-card__photo-count">
                            📷 {wp.photos.length} photo{wp.photos.length > 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {wp.photos && wp.photos.length > 0 && (
                    <img
                      src={wp.photos[0]}
                      alt=""
                      className="waypoint-card__thumb"
                    />
                  )}

                  <div className="waypoint-card__status-row">
                    <button
                      type="button"
                      onClick={() => onUpdateWaypointStatus(wp.id, 'done')}
                      className={`waypoint-card__status-btn ${isDone ? 'is-selected is-done' : ''}`}
                    >
                      Fait
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateWaypointStatus(wp.id, 'active')}
                      className={`waypoint-card__status-btn ${isActive ? 'is-selected is-active' : ''}`}
                    >
                      Actif
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateWaypointStatus(wp.id, 'upcoming')}
                      className={`waypoint-card__status-btn ${wp.status === 'upcoming' ? 'is-selected is-upcoming' : ''}`}
                    >
                      À venir
                    </button>
                  </div>

                  <div className="waypoint-card__actions">
                    {hasValidCoords(wp.lat, wp.lng) && (
                      <button
                        type="button"
                        onClick={() => onSelectOnMap(wp.lat, wp.lng, wp.title, emoji)}
                        className="waypoint-card__action waypoint-card__action--map"
                        title={`Voir ${wp.title} sur la carte`}
                      >
                        <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                        Voir sur la carte
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedWaypointId(isExpanded ? null : wp.id)}
                      className={`waypoint-card__action waypoint-card__action--toggle ${isExpanded ? 'is-open' : ''}`}
                      aria-label={isExpanded ? `Réduire ${wp.title}` : `Afficher les détails de ${wp.title}`}
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="waypoint-card__details space-y-3">
                  {wp.photos && wp.photos.length > 0 && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {wp.photos.map((src, photoIndex) => (
                        <img
                          key={`${wp.id}-photo-${photoIndex}`}
                          src={src}
                          alt={`Photo ${photoIndex + 1} — ${wp.title}`}
                          className="h-20 w-full rounded-xl object-cover border border-zinc-200"
                        />
                      ))}
                    </div>
                  )}
                  {visibleNotes && (
                    <p className="text-xs leading-relaxed text-zinc-600 italic bg-zinc-50 px-3 py-2.5 rounded-2xl border border-zinc-100">
                      “{visibleNotes}”
                    </p>
                  )}
                  {wp.amenities && wp.amenities.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {wp.amenities.map((am) => (
                        <span key={am} className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200">
                          {am === 'eau' ? '🚰 Eau' : am === 'ombre' ? '🌲 Ombre' : am === 'gratuit' ? '🆓 Gratuit' : am === 'wc' ? '🚽 WC' : am === 'douche' ? '🚿 Douche' : '✨ ' + am}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Organisation
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onReorderWaypoint(wp.id, 'up')}
                        disabled={index === 0}
                        className="flex min-h-9 items-center gap-1 rounded-xl bg-zinc-100 px-3 py-2 text-[10px] font-bold text-zinc-700 hover:bg-zinc-200 disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" /> Monter
                      </button>
                      <button
                        type="button"
                        onClick={() => onReorderWaypoint(wp.id, 'down')}
                        disabled={index === sortedWaypoints.length - 1}
                        className="flex min-h-9 items-center gap-1 rounded-xl bg-zinc-100 px-3 py-2 text-[10px] font-bold text-zinc-700 hover:bg-zinc-200 disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" /> Descendre
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Supprimer l’étape « ${wp.title} » ?`)) {
                            onDeleteWaypoint(wp.id);
                          }
                        }}
                        className="flex min-h-9 items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-[10px] font-bold text-red-600 hover:bg-red-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </button>
                    </div>
                  </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <SimpleFormModal
        isOpen={showAddModal}
        onClose={closeAddModal}
        title="Ajouter une étape"
        subtitle="Nom · lieu · détails"
        icon={<Milestone className="h-4 w-4" />}
        titleId="add-waypoint-title"
        onSubmit={(e) => void handleCreateSubmit(e)}
        footer={
          <FormModalFooter
            onCancel={closeAddModal}
            submitLabel="Ajouter l'étape"
            canSubmit={canSubmitWaypoint}
            saving={saving}
            submitTone="sunset"
          />
        }
      >
        <CompactFormRoot>
          <CompactFormHero>
            <CompactFormField label="Nom *" tone="hero">
              <CompactFormTextInput
                tone="hero"
                required
                placeholder="Bivouac au lac, aire de nuit…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="font-extrabold"
              />
            </CompactFormField>
            <CompactFormField label="Lieu *" tone="hero">
              <div className="space-y-1.5">
                <PlaceAutocompleteInput
                  tone="hero"
                  required
                  placeholder="Ville, spot, adresse…"
                  value={locationName}
                  onChange={(value) => {
                    setLocationName(value);
                    setLat('');
                    setLng('');
                    setFormError('');
                  }}
                  onSelectPlace={(place) => {
                    setLocationName(place.name);
                    setLat(String(place.lat));
                    setLng(String(place.lng));
                    setFormError('');
                  }}
                />
                <button
                  type="button"
                  onClick={() => void useCurrentPlace()}
                  disabled={locating}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-2.5 py-2 text-[10px] font-extrabold uppercase tracking-wide text-white transition enabled:active:scale-[0.99] disabled:opacity-60"
                >
                  {locating ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <LocateFixed className="h-3.5 w-3.5" />
                  )}
                  {locating ? 'Recherche du lieu…' : 'Ma position · ville / village'}
                </button>
                {hasValidPlaceCoords && locationName.trim() && (
                  <p className="px-0.5 text-[9px] font-semibold text-white/55">
                    Coords GPS synchronisées · {parsedLat.toFixed(4)}, {parsedLng.toFixed(4)}
                  </p>
                )}
              </div>
            </CompactFormField>
          </CompactFormHero>

          <CompactFormSection>
            <CompactFormField label="Notes">
              <CompactFormTextInput
                placeholder="Heure, eau, calme…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </CompactFormField>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                  Photos
                </span>
                <span className="text-[9px] font-bold text-[#68756d]">
                  {photos.length}/{MAX_WAYPOINT_PHOTOS}
                </span>
              </div>
              {photos.length > 0 && (
                <div className="mb-1.5 grid grid-cols-4 gap-1">
                  {photos.map((src, index) => (
                    <div key={`new-photo-${index}`} className="relative">
                      <img
                        src={src}
                        alt=""
                        className="h-14 w-full rounded-lg border border-[#17352b]/10 object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                        className="absolute top-0.5 right-0.5 rounded-full bg-[#17352b]/75 p-0.5 text-white"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={photos.length >= MAX_WAYPOINT_PHOTOS}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#17352b]/15 bg-white px-2 py-1.5 text-[10px] font-bold text-[#68756d] disabled:opacity-40"
              >
                {photos.length ? <ImagePlus className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                {photos.length ? 'Ajouter' : 'Importer des photos'}
              </button>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handlePhotosSelected(e)}
              />
              {photoError && (
                <p className="mt-1 text-[9px] font-semibold text-amber-700">{photoError}</p>
              )}
              {formError && (
                <p className="mt-1 rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800">
                  {formError}
                </p>
              )}
            </div>
          </CompactFormSection>
        </CompactFormRoot>
      </SimpleFormModal>
    </div>
  );
};

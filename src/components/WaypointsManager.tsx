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
  ImagePlus
} from 'lucide-react';
import { Waypoint } from '../types';

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
  onAddWaypoint: (newWp: Omit<Waypoint, 'id'>) => void;
  onUpdateWaypointStatus: (id: string, status: 'done' | 'active' | 'upcoming') => void;
  onReorderWaypoint: (id: string, direction: 'up' | 'down') => void;
  onDeleteWaypoint: (id: string) => void;
  onSelectOnMap: (lat: number, lng: number) => void;
}

export const WaypointsManager: React.FC<WaypointsManagerProps> = ({
  waypoints,
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
  const [lat, setLat] = useState('45.8992');
  const [lng, setLng] = useState('6.1294');
  const [vanSpotType, setVanSpotType] = useState('Wild Spot / Parking discret');
  const [notes, setNotes] = useState('');
  const [amenities, setAmenities] = useState<string[]>(['eau', 'gratuit', 'vue_panoramique']);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);

  const resetAddForm = () => {
    setTitle('');
    setLocationName('');
    setNotes('');
    setPhotos([]);
    setPhotoError('');
    setAmenities(['eau', 'gratuit', 'vue_panoramique']);
    setVanSpotType('Wild Spot / Parking discret');
    setLat('45.8992');
    setLng('6.1294');
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !locationName.trim()) return;

    onAddWaypoint({
      order: waypoints.length + 1,
      title: title.trim(),
      locationName: locationName.trim(),
      lat: parseFloat(lat) || 45.8992,
      lng: parseFloat(lng) || 6.1294,
      status: 'upcoming',
      vanSpotType: vanSpotType.trim(),
      notes: notes.trim(),
      amenities,
      photos: photos.length ? photos : undefined,
    });

    resetAddForm();
    setShowAddModal(false);
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

  const toggleAmenity = (item: string) => {
    if (amenities.includes(item)) {
      setAmenities(amenities.filter((a) => a !== item));
    } else {
      setAmenities([...amenities, item]);
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
          onClick={() => setShowAddModal(true)}
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
      <div className="space-y-3">
        {sortedWaypoints.length === 0 ? (
          <div className="bg-white rounded-[2rem] p-8 text-center text-zinc-400 border border-zinc-200 text-xs font-medium">
            Aucune étape configurée. Ajoutez votre première étape pour démarrer l’itinéraire.
          </div>
        ) : (
          sortedWaypoints.map((wp, index) => {
            const isDone = wp.status === 'done';
            const isActive = wp.status === 'active';
            const isExpanded = expandedWaypointId === wp.id || (expandedWaypointId === null && isActive);
            const statusLabel = isDone ? 'Visité' : isActive ? 'En cours' : 'À venir';
            const visibleNotes = withoutSource(wp.notes);

            return (
              <div
                key={wp.id}
                className={`rounded-[1.75rem] border transition-all relative overflow-hidden bg-white shadow-sm ${
                  isActive
                    ? 'border-emerald-400 ring-2 ring-emerald-500/15 shadow-emerald-950/5'
                    : isDone
                    ? 'border-zinc-200'
                    : 'border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="p-3.5 sm:p-4 flex items-start justify-between gap-2.5">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    {/* Badge Order Circle */}
                    <div
                      className={`w-9 h-9 rounded-2xl flex items-center justify-center font-black text-xs shrink-0 font-mono ${
                        isActive
                          ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-200'
                          : isDone
                          ? 'bg-zinc-200 text-zinc-600'
                          : 'bg-zinc-100 text-zinc-800 border border-zinc-200'
                      }`}
                    >
                      {wp.order}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-extrabold text-[15px] leading-tight text-zinc-900 truncate max-w-full">
                          {wp.title}
                        </h3>
                        <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : isDone ? 'bg-zinc-100 text-zinc-600' : 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'}`}>
                          {isActive ? '● ' : isDone ? '✓ ' : '• '}{statusLabel}
                        </span>
                      </div>

                      <p className="text-xs text-zinc-500 font-medium flex items-center gap-1 mt-0.5 min-w-0">
                        <MapPin className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
                        <span className="truncate">{wp.locationName}</span>
                      </p>

                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {wp.vanSpotType && (
                          <div className="inline-block text-[10px] font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                            🚐 {wp.vanSpotType}
                          </div>
                        )}
                        {wp.photos && wp.photos.length > 0 && (
                          <div className="inline-flex items-center gap-1.5">
                            <img
                              src={wp.photos[0]}
                              alt=""
                              className="w-7 h-7 rounded-lg object-cover border border-zinc-200"
                            />
                            <span className="text-[10px] font-bold text-zinc-500">
                              {wp.photos.length} photo{wp.photos.length > 1 ? 's' : ''}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Up/Down Ordering */}
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onSelectOnMap(wp.lat, wp.lng)}
                      className="touch-target flex items-center justify-center rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-colors"
                      title={`Voir ${wp.title} sur la carte`}
                      aria-label={`Voir ${wp.title} sur la carte`}
                    >
                      <Navigation className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedWaypointId(isExpanded ? null : wp.id)}
                      className="touch-target flex items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 transition-colors"
                      aria-label={isExpanded ? `Réduire ${wp.title}` : `Afficher les détails de ${wp.title}`}
                    >
                      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {isExpanded && <div className="px-4 pb-4 space-y-3">
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
                  <div className="pt-3 border-t border-zinc-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Mettre à jour</span>
                    <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onUpdateWaypointStatus(wp.id, 'done')}
                      className={`touch-chip px-3 py-2 rounded-full text-[10px] font-bold ${
                        isDone ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                      >
                      Fait
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateWaypointStatus(wp.id, 'active')}
                      className={`touch-chip px-3 py-2 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-emerald-600 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                      >
                      Actif
                    </button>
                    <button
                      type="button"
                      onClick={() => onUpdateWaypointStatus(wp.id, 'upcoming')}
                      className={`touch-chip px-3 py-2 rounded-full text-[10px] font-bold ${
                        wp.status === 'upcoming' ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                      }`}
                      >
                      À venir
                    </button>
                  </div>
                  </div>
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
                </div>}
              </div>
            );
          })
        )}
      </div>

      {/* Add Waypoint Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white rounded-[2rem] p-6 shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-100 mb-4">
              <h3 className="min-w-0 font-extrabold text-sm text-zinc-900 flex items-center gap-1.5 leading-snug">
                <Milestone className="w-4 h-4 shrink-0 text-emerald-600" /> Ajouter une étape
              </h3>
              <button
                type="button"
                onClick={() => {
                  resetAddForm();
                  setShowAddModal(false);
                }}
                className="touch-target flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 -mr-1"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Nom de l'Étape *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Bivouac Lac du Mont-Cenis"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 focus:outline-hidden focus:ring-2 focus:ring-zinc-900 bg-zinc-50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Commune / Ville *</label>
                <input
                  type="text"
                  required
                  placeholder="ex: Lanslebourg-Mont-Cenis"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 focus:outline-hidden focus:ring-2 focus:ring-zinc-900 bg-zinc-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lat}
                    onChange={(e) => setLat(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={lng}
                    onChange={(e) => setLng(e.target.value)}
                    className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Type de Spot Van</label>
                <input
                  type="text"
                  placeholder="ex: Wild spot, Aire naturelle, Camping"
                  value={vanSpotType}
                  onChange={(e) => setVanSpotType(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Notes / Remarques</label>
                <textarea
                  rows={2}
                  placeholder="Heure limite d'arrivée, fontaine d'eau, calme..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full text-xs px-3.5 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50"
                ></textarea>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  Photos du spot
                  <span className="ml-1 font-medium text-zinc-400">
                    ({photos.length}/{MAX_WAYPOINT_PHOTOS})
                  </span>
                </label>
                {photos.length > 0 && (
                  <div className="mb-2 grid grid-cols-3 gap-1.5">
                    {photos.map((src, index) => (
                      <div key={`new-photo-${index}`} className="relative group">
                        <img
                          src={src}
                          alt={`Photo ${index + 1}`}
                          className="h-20 w-full rounded-xl object-cover border border-zinc-200"
                        />
                        <button
                          type="button"
                          onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                          className="absolute top-1 right-1 p-1 rounded-full bg-zinc-950/70 text-white opacity-90 hover:opacity-100"
                          title="Retirer la photo"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photos.length >= MAX_WAYPOINT_PHOTOS}
                  className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 text-xs font-bold text-zinc-600 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                >
                  {photos.length ? <ImagePlus className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
                  {photos.length ? 'Ajouter d’autres photos' : 'Importer des photos'}
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handlePhotosSelected(e)}
                />
                {photoError ? (
                  <p className="mt-1.5 text-[10px] font-semibold text-amber-700">{photoError}</p>
                ) : (
                  <p className="mt-1.5 text-[10px] font-medium text-zinc-400">
                    JPG / PNG, jusqu’à {MAX_WAYPOINT_PHOTOS} photos
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">Commodités du Spot</label>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { id: 'eau', label: '🚰 Eau' },
                    { id: 'ombre', label: '🌲 Ombre' },
                    { id: 'gratuit', label: '🆓 Gratuit' },
                    { id: 'wc', label: '🚽 WC' },
                    { id: 'douche', label: 'Shower' }
                  ].map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => toggleAmenity(item.id)}
                      className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                        amenities.includes(item.id)
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    resetAddForm();
                    setShowAddModal(false);
                  }}
                  className="px-3.5 py-2 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-zinc-900 text-white rounded-xl shadow-xs hover:bg-zinc-800"
                >
                  Ajouter l'Étape
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { 
  BookOpen, 
  Camera, 
  Image as ImageIcon,
  Plus, 
  User, 
  Calendar, 
  MapPin, 
  X, 
  Filter,
  Trash2,
} from 'lucide-react';
import { JournalNote, TripPhoto, Friend, GpsPoint } from '../types';
import { isGeolocationAvailable, reverseGeocodeCity } from '../services/geolocation';
import { StepFormModal } from './StepFormModal';
import { ModalShell } from './ModalShell';

const ADD_NOTE_STEPS = [
  { id: 1, label: 'Infos', hint: 'Titre et lieu' },
  { id: 2, label: 'Récit', hint: 'Histoire et photo' },
] as const;

const ADD_PHOTO_STEPS = [
  { id: 1, label: 'Image', hint: 'Choisir une photo' },
  { id: 2, label: 'Détails', hint: 'Légende et lieu' },
] as const;

function formatPhotoDate(isoDate: string) {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

async function fileToPhotoDataUrl(file: File, maxSize = 1280): Promise<string> {
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

const PhotoThumb: React.FC<{
  src: string;
  alt?: string;
  className?: string;
}> = ({ src, alt, className }) => {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-zinc-800 text-zinc-400 ${className ?? ''}`}>
        <ImageIcon className="w-7 h-7 opacity-60" />
        <span className="text-[10px] font-medium">Aperçu indisponible</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || 'Photo'}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`absolute inset-0 w-full h-full object-cover ${className ?? ''}`}
    />
  );
};

interface JournalAndPhotosProps {
  notes: JournalNote[];
  photos: TripPhoto[];
  friends: Friend[];
  currentFriendId: string;
  userLocation: GpsPoint | null;
  onAddNote: (newNote: Omit<JournalNote, 'id'>) => void;
  onAddPhoto: (newPhoto: Omit<TripPhoto, 'id'>) => void;
  onDeletePhoto: (id: string) => void;
}

export const JournalAndPhotos: React.FC<JournalAndPhotosProps> = ({
  notes,
  photos,
  friends,
  currentFriendId,
  userLocation,
  onAddNote,
  onAddPhoto,
  onDeletePhoto,
}) => {
  const [activeTab, setActiveTab] = useState<'journal' | 'photos'>('journal');
  const [selectedFriendFilter, setSelectedFriendFilter] = useState<string>('all');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [noteStep, setNoteStep] = useState(1);
  const [photoStep, setPhotoStep] = useState(1);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<TripPhoto | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<TripPhoto | null>(null);

  // New Note Form State
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteLocation, setNoteLocation] = useState('Lac d\'Annecy');
  const [notePhotoUrl, setNotePhotoUrl] = useState('');

  // New Photo Form State
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoLocation, setPhotoLocation] = useState('');
  const [photoCoords, setPhotoCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);

  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;

    onAddNote({
      title: noteTitle.trim(),
      content: noteContent.trim(),
      date: new Date().toISOString().split('T')[0],
      friendId: currentFriendId,
      locationName: noteLocation.trim(),
      photos: notePhotoUrl.trim() ? [notePhotoUrl.trim()] : []
    });

    setNoteTitle('');
    setNoteContent('');
    setNotePhotoUrl('');
    setNoteStep(1);
    setShowNoteModal(false);
  };

  const handleCreatePhoto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoUrlInput.trim()) return;

    onAddPhoto({
      url: photoUrlInput.trim(),
      caption: photoCaption.trim(),
      date: new Date().toISOString().split('T')[0],
      friendId: currentFriendId,
      locationName: photoLocation.trim(),
      lat: photoCoords?.lat,
      lng: photoCoords?.lng,
    });

    setPhotoUrlInput('');
    setPhotoCaption('');
    setPhotoLocation('');
    setPhotoCoords(null);
    setPhotoStep(1);
    setShowPhotoModal(false);
  };

  const handleImageFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, isNote: boolean) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await fileToPhotoDataUrl(file);
      if (isNote) {
        setNotePhotoUrl(dataUrl);
      } else {
        setPhotoUrlInput(dataUrl);
      }
    } catch {
      // Fallback: raw data URL if canvas resize fails
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (!result) return;
        if (isNote) setNotePhotoUrl(result);
        else setPhotoUrlInput(result);
      };
      reader.readAsDataURL(file);
    } finally {
      e.target.value = '';
    }
  };

  const filteredNotes = notes.filter((n) =>
    selectedFriendFilter === 'all' ? true : n.friendId === selectedFriendFilter
  );

  const filteredPhotos = photos.filter((p) =>
    selectedFriendFilter === 'all' ? true : p.friendId === selectedFriendFilter
  );

  const previewAuthor = selectedPhotoPreview
    ? friends.find((f) => f.id === selectedPhotoPreview.friendId)
    : undefined;

  useEffect(() => {
    if (!showPhotoModal) return;

    let cancelled = false;
    const controller = new AbortController();

    const applyCoords = async (lat: number, lng: number) => {
      if (cancelled) return;
      setPhotoCoords({ lat, lng });
      setLocationLoading(true);
      try {
        const city = await reverseGeocodeCity(lat, lng, controller.signal);
        if (!cancelled && city) setPhotoLocation(city);
      } catch {
        // Keep manual entry if reverse geocoding fails.
      } finally {
        if (!cancelled) setLocationLoading(false);
      }
    };

    if (userLocation) {
      void applyCoords(userLocation.lat, userLocation.lng);
    } else if (isGeolocationAvailable()) {
      navigator.geolocation.getCurrentPosition(
        (position) => void applyCoords(position.coords.latitude, position.coords.longitude),
        () => {
          if (!cancelled) setLocationLoading(false);
        },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 }
      );
    }

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [showPhotoModal, userLocation]);

  useEffect(() => {
    if (!selectedPhotoPreview) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedPhotoPreview(null);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [selectedPhotoPreview]);

  return (
    <div className="page-pad space-y-3 sm:space-y-4">
      {/* Top Switcher & Action Header */}
      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-3.5 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-4">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full items-center gap-1 bg-zinc-100 p-1 rounded-2xl ring-1 ring-zinc-200 sm:w-auto">
            <button
              type="button"
              onClick={() => setActiveTab('journal')}
              className={`min-h-10 flex-1 sm:flex-none justify-center px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'journal'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
              <span>Journal</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('photos')}
              className={`min-h-10 flex-1 sm:flex-none justify-center px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'photos'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Camera className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
              <span>Photos</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'journal') {
                setNoteStep(1);
                setShowNoteModal(true);
              } else {
                setPhotoStep(1);
                setShowPhotoModal(true);
              }
            }}
            className="min-h-11 w-full sm:w-auto justify-center rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white shadow-xs transition-all font-bold text-xs flex items-center gap-1.5 px-4 py-2.5"
          >
            <Plus className="w-4 h-4 text-emerald-400" /> {activeTab === 'journal' ? 'Note' : 'Photo'}
          </button>
        </div>

        {/* Friend Filter Bar */}
        <div className="flex flex-col gap-2 pt-1 border-t border-zinc-100 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-xs font-bold text-zinc-500 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5 text-zinc-400" /> Filtrer
          </span>
          <select
            value={selectedFriendFilter}
            onChange={(e) => setSelectedFriendFilter(e.target.value)}
            className="min-h-10 w-full sm:w-auto max-w-full bg-zinc-100 text-xs font-bold text-zinc-800 rounded-xl px-3 py-2 focus:outline-hidden cursor-pointer ring-1 ring-zinc-200"
          >
            <option value="all">Tous les copains</option>
            {friends.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* JOURNAL TAB */}
      {activeTab === 'journal' && (
        <div className="space-y-3">
          {filteredNotes.length === 0 ? (
            <div className="bg-white rounded-[2rem] p-8 text-center text-zinc-400 border border-zinc-200 text-xs font-medium">
              Aucune note de journal pour ce filtre. Écrivez le premier souvenir de voyage !
            </div>
          ) : (
            filteredNotes.map((note) => {
              const author = friends.find((f) => f.id === note.friendId);

              return (
                <div
                  key={note.id}
                  className="bg-white border border-zinc-200 rounded-[2rem] p-5 shadow-xs space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <img
                        src={author?.avatar}
                        alt={author?.name}
                        className="w-7 h-7 shrink-0 rounded-full object-cover ring-2 ring-white"
                      />
                      <div className="min-w-0">
                        <span className="block truncate text-xs font-bold" style={{ color: author?.color }}>
                          {author?.name}
                        </span>
                        <p className="text-[10px] text-zinc-400 font-mono font-medium">{note.date}</p>
                      </div>
                    </div>

                    {note.locationName && (
                      <span className="max-w-full sm:max-w-[55%] text-[11px] font-semibold text-zinc-600 bg-zinc-100 ring-1 ring-zinc-200 px-2.5 py-1 rounded-full inline-flex items-center gap-1 min-w-0">
                        <MapPin className="w-3 h-3 shrink-0 text-emerald-600" />
                        <span className="truncate">{note.locationName}</span>
                      </span>
                    )}
                  </div>

                  <h3 className="font-extrabold text-sm text-zinc-900 leading-snug">{note.title}</h3>
                  <p className="note-body text-xs text-zinc-600 leading-relaxed whitespace-pre-line">{note.content}</p>

                  {note.photos && note.photos.length > 0 && (
                    <div
                      className="mt-2 relative h-44 rounded-2xl overflow-hidden border border-zinc-200 cursor-pointer"
                      onClick={() =>
                        setSelectedPhotoPreview({
                          id: note.id,
                          url: note.photos![0],
                          caption: note.title,
                          date: note.date,
                          friendId: note.friendId,
                          locationName: note.locationName
                        })
                      }
                    >
                      <PhotoThumb
                        src={note.photos[0]}
                        alt="Photo de note"
                        className="hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* PHOTOS GALLERY TAB */}
      {activeTab === 'photos' && (
        <div className="space-y-3">
          {filteredPhotos.length === 0 ? (
            <div className="bg-white rounded-[2rem] p-8 text-center text-zinc-400 border border-zinc-200 text-xs font-medium">
              Aucune photo disponible. Prenez une photo avec votre van !
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filteredPhotos.map((photo) => {
                const author = friends.find((f) => f.id === photo.friendId);

                return (
                  <div
                    key={photo.id}
                    className="group relative rounded-[2rem] overflow-hidden bg-zinc-900 border border-zinc-200 shadow-xs aspect-square"
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPhotoPreview(photo)}
                      className="absolute inset-0 z-0 cursor-pointer"
                      aria-label={photo.caption || 'Ouvrir la photo'}
                    >
                      <PhotoThumb
                        src={photo.url}
                        alt={photo.caption}
                        className="group-hover:scale-110 transition-transform duration-300"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPhotoToDelete(photo);
                      }}
                      className="absolute right-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-zinc-950/70 text-white ring-1 ring-white/20 backdrop-blur-sm transition hover:bg-red-600"
                      aria-label={`Supprimer ${photo.caption || 'la photo'}`}
                      title="Supprimer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-t from-zinc-950/85 via-transparent to-transparent opacity-90 p-3 flex flex-col justify-end">
                      <p className="text-white text-xs font-bold line-clamp-1">{photo.caption || 'Photo Van'}</p>
                      <div className="flex items-center justify-between text-[10px] text-zinc-300 mt-1 font-mono">
                        <span style={{ color: author?.color }} className="font-bold">
                          {author?.name}
                        </span>
                        <span>{photo.date}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add Journal Note Modal — 2 étapes */}
      <StepFormModal
        isOpen={showNoteModal}
        onClose={() => {
          setNoteStep(1);
          setShowNoteModal(false);
        }}
        title="Nouvelle note"
        subtitle="Raconte ta journée de vanlife"
        icon={<BookOpen className="w-5 h-5" />}
        iconBgClassName="bg-emerald-600"
        steps={ADD_NOTE_STEPS}
        currentStep={noteStep}
        onStepClick={setNoteStep}
        canAdvanceFromStep={(step) => {
          if (step === 1) return Boolean(noteTitle.trim());
          return Boolean(noteContent.trim());
        }}
        onNext={() => setNoteStep(2)}
        onPrevious={() => setNoteStep(1)}
        onSubmit={handleCreateNote}
        submitLabel="Publier"
        titleId="add-note-title"
      >
        {noteStep === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Titre de l'anecdote *</span>
              <input
                type="text"
                required
                placeholder="ex: Apéro du soir & saucisson d'altitude"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                className="w-full text-sm font-semibold px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Lieu / Étape</span>
              <input
                type="text"
                placeholder="ex: Lac d'Annecy"
                value={noteLocation}
                onChange={(e) => setNoteLocation(e.target.value)}
                className="w-full text-sm font-medium px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </label>
          </div>
        )}
        {noteStep === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
            <div className="rounded-2xl border border-[#17352b]/10 bg-[#17352b] p-4 text-white">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-300">Récapitulatif</p>
              <p className="mt-1 truncate text-base font-extrabold">{noteTitle || 'Sans titre'}</p>
              {noteLocation && (
                <p className="mt-0.5 truncate text-[11px] font-medium text-white/70">📍 {noteLocation}</p>
              )}
            </div>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Récit du jour *</span>
              <textarea
                rows={5}
                required
                placeholder="Racontez la journée, les galères de route, les rires..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                className="w-full resize-none text-sm px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Photo d'illustration</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFileSelect(e, true)}
                className="w-full text-xs text-[#68756d] file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-[#f5f1e7] file:text-[#17352b] hover:file:bg-[#ebe4d4]"
              />
              {notePhotoUrl && (
                <div className="rounded-xl overflow-hidden border border-[#17352b]/10 h-32">
                  <img src={notePhotoUrl} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
            </label>
          </div>
        )}
      </StepFormModal>

      {/* Add Photo Modal — 2 étapes */}
      <StepFormModal
        isOpen={showPhotoModal}
        onClose={() => {
          setPhotoStep(1);
          setShowPhotoModal(false);
        }}
        title="Ajouter une photo"
        subtitle="Immortalise un moment de route"
        icon={<Camera className="w-5 h-5" />}
        iconBgClassName="bg-emerald-600"
        steps={ADD_PHOTO_STEPS}
        currentStep={photoStep}
        onStepClick={setPhotoStep}
        canAdvanceFromStep={(step) => {
          if (step === 1) return Boolean(photoUrlInput.trim());
          return true;
        }}
        onNext={() => setPhotoStep(2)}
        onPrevious={() => setPhotoStep(1)}
        onSubmit={handleCreatePhoto}
        submitLabel="Ajouter"
        titleId="add-photo-title"
      >
        {photoStep === 1 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Prendre / Choisir une image *</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFileSelect(e, false)}
                className="w-full text-xs text-[#68756d] file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 mb-2"
              />
              <input
                type="url"
                placeholder="ou coller l'URL d'une image..."
                value={photoUrlInput}
                onChange={(e) => setPhotoUrlInput(e.target.value)}
                className="w-full text-sm px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            {photoUrlInput && (
              <div className="rounded-xl overflow-hidden border border-[#17352b]/10 h-40">
                <img src={photoUrlInput} alt="Preview" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
        )}
        {photoStep === 2 && (
          <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
            {photoUrlInput && (
              <div className="rounded-xl overflow-hidden border border-[#17352b]/10 h-36">
                <img src={photoUrlInput} alt="Preview" className="w-full h-full object-cover" />
              </div>
            )}
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Légende de la photo</span>
              <input
                type="text"
                placeholder="ex: Vue du van au coucher de soleil"
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
                className="w-full text-sm px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[11px] font-bold text-[#17352b]">Lieu</span>
              <input
                type="text"
                placeholder={locationLoading ? 'Localisation en cours…' : 'ex: Annecy'}
                value={photoLocation}
                onChange={(e) => setPhotoLocation(e.target.value)}
                className="w-full text-sm px-3.5 py-3 rounded-2xl border border-[#17352b]/12 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </label>
          </div>
        )}
      </StepFormModal>

      {/* Immersive photo viewer */}
      {selectedPhotoPreview && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label={selectedPhotoPreview.caption || 'Aperçu photo'}
          onClick={() => setSelectedPhotoPreview(null)}
        >
          <div
            className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0 flex items-center gap-2.5">
              {previewAuthor?.avatar ? (
                <img
                  src={previewAuthor.avatar}
                  alt=""
                  className="h-8 w-8 rounded-full object-cover ring-2 ring-white/15"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 ring-2 ring-white/10">
                  <User className="h-4 w-4 text-zinc-400" />
                </div>
              )}
              <div className="min-w-0">
                <p
                  className="truncate text-sm font-bold text-white"
                  style={previewAuthor?.color ? { color: previewAuthor.color } : undefined}
                >
                  {previewAuthor?.name || 'Équipage'}
                </p>
                <p className="truncate text-[11px] font-medium text-zinc-400">
                  {formatPhotoDate(selectedPhotoPreview.date)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedPhotoPreview(null)}
              className="shrink-0 rounded-full bg-white/10 p-2.5 text-white ring-1 ring-white/15 transition hover:bg-white/20"
              aria-label="Fermer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 items-center justify-center px-2"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Soft vignette so the photo reads as the stage */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.06),transparent_65%)]"
            />
            <img
              src={selectedPhotoPreview.url}
              alt={selectedPhotoPreview.caption || 'Photo du voyage'}
              className="relative z-10 max-h-full max-w-full rounded-lg object-contain shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>

          <div
            className="relative px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-gradient-to-t from-zinc-950 to-transparent" />
            <div className="relative mx-auto w-full max-w-lg space-y-3">
              <h3 className="text-lg font-extrabold leading-snug text-white">
                {selectedPhotoPreview.caption?.trim() || 'Souvenir de route'}
              </h3>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-medium text-zinc-300">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-emerald-400" />
                  {selectedPhotoPreview.locationName?.trim() || 'Road trip'}
                </span>
                <span className="inline-flex items-center gap-1.5 text-zinc-400">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatPhotoDate(selectedPhotoPreview.date)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPhotoToDelete(selectedPhotoPreview)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-red-600/90 px-4 py-2.5 text-xs font-extrabold text-white ring-1 ring-red-400/30 transition hover:bg-red-500"
              >
                <Trash2 className="h-4 w-4" />
                Supprimer cette photo
              </button>
            </div>
          </div>
        </div>
      )}

      <ModalShell
        isOpen={Boolean(photoToDelete)}
        onClose={() => setPhotoToDelete(null)}
        maxWidth="sm"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h3 className="text-base font-extrabold text-[#17352b]">Supprimer cette photo ?</h3>
            <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-[#68756d]">
              « {photoToDelete?.caption?.trim() || 'Souvenir de route'} » sera retirée de la galerie
              pour tout l’équipage.
            </p>
          </div>
          <div className="flex gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setPhotoToDelete(null)}
              className="min-h-11 flex-1 rounded-xl bg-[#f5f1e7] px-4 py-2.5 text-xs font-bold text-[#68756d]"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => {
                if (!photoToDelete) return;
                const id = photoToDelete.id;
                onDeletePhoto(id);
                setPhotoToDelete(null);
                if (selectedPhotoPreview?.id === id) setSelectedPhotoPreview(null);
              }}
              className="min-h-11 flex-[1.2] rounded-xl bg-red-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-red-500"
            >
              Oui, supprimer
            </button>
          </div>
        </div>
      </ModalShell>
    </div>
  );
};

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
  ChevronLeft,
  Images,
  Video,
  Play,
} from 'lucide-react';
import { JournalNote, TripPhoto, Friend, GpsPoint } from '../types';
import { groupPhotosIntoAlbums, type PhotoAlbum } from '../lib/photoAlbums';
import { fileToVideoDataUrl, isVideoMedia, mediaCountLabel } from '../lib/mediaUtils';
import { SimpleFormModal } from './SimpleFormModal';
import {
  CompactFormField,
  CompactFormHero,
  CompactFormRoot,
  CompactFormSection,
  CompactFormTextInput,
  CompactFormTextarea,
  FormModalFooter,
} from './CompactFormLayout';
import { ModalShell } from './ModalShell';

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

const MediaThumb: React.FC<{
  src: string;
  alt?: string;
  className?: string;
  video?: boolean;
  mutedPreview?: boolean;
}> = ({ src, alt, className, video, mutedPreview = true }) => {
  const [failed, setFailed] = useState(false);
  const isVideo = video ?? isVideoMedia({ url: src });

  if (!src || failed) {
    return (
      <div className={`absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-zinc-800 text-zinc-400 ${className ?? ''}`}>
        {isVideo ? <Video className="w-7 h-7 opacity-60" /> : <ImageIcon className="w-7 h-7 opacity-60" />}
        <span className="text-[10px] font-medium">Aperçu indisponible</span>
      </div>
    );
  }

  if (isVideo) {
    return (
      <video
        src={src}
        muted={mutedPreview}
        playsInline
        preload="metadata"
        onError={() => setFailed(true)}
        className={`absolute inset-0 w-full h-full object-cover ${className ?? ''}`}
      />
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

const PhotoThumb = MediaThumb;

const PhotoFolderCover: React.FC<{ src: string; alt?: string; video?: boolean }> = ({ src, alt, video }) => {
  const [failed, setFailed] = useState(false);
  const isVideo = video ?? isVideoMedia({ url: src });

  if (!src || failed) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-800">
        {isVideo ? <Video className="h-6 w-6 text-zinc-500" /> : <ImageIcon className="h-6 w-6 text-zinc-500" />}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="relative h-full w-full bg-zinc-900">
        <video
          src={src}
          muted
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover opacity-80"
        />
        <span className="absolute inset-0 grid place-items-center text-white/90">
          <Play className="h-6 w-6 fill-current" />
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt || ''}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
};

const PhotoFolderCard: React.FC<{
  album: PhotoAlbum;
  onOpen: () => void;
}> = ({ album, onOpen }) => {
  const cover = album.photos[0]?.url;
  const stack = album.photos.slice(0, 3);

  return ( 
    
    <button type="button" className="photo-folder" onClick={onOpen}>
      <div className="photo-folder__covers">
        {stack.length > 1 ? (
          <div className="photo-folder__cover-stack">
            {stack.map((photo) => (
              <PhotoFolderCover
                key={photo.id}
                src={photo.url}
                video={isVideoMedia(photo)}
              />
            ))}
          </div>
        ) : cover ? (
          <PhotoFolderCover src={cover} video={isVideoMedia(album.photos[0])} />
        ) : (
          <div className="flex h-full items-center justify-center bg-zinc-800">
            <ImageIcon className="h-8 w-8 text-zinc-500" />
          </div>
        )}
        <span className="photo-folder__badge">
          <Images className="h-3 w-3" />
          {album.photos.length}
        </span>
      </div>
      <div className="photo-folder__body">
        <div className="photo-folder__title-row">
          <span className="photo-folder__emoji" aria-hidden>{album.emoji}</span>
          <h3 className="photo-folder__title">{album.title}</h3>
        </div>
        <p className="photo-folder__meta">{album.subtitle}</p>
      </div>
    </button>
  );
};

const PhotoGalleryTile: React.FC<{
  photo: TripPhoto;
  author?: Friend;
  featured?: boolean;
  onOpen: () => void;
  onDelete: () => void;
}> = ({ photo, author, featured, onOpen, onDelete }) => {
  const video = isVideoMedia(photo);
  return (
  <article className={`photo-gallery__tile ${featured ? 'photo-gallery__tile--featured' : ''}`}>
    <button
      type="button"
      className="photo-gallery__tile-btn"
      onClick={onOpen}
      aria-label={photo.caption || (video ? 'Ouvrir la vidéo' : 'Ouvrir la photo')}
    >
      <MediaThumb
        src={photo.url}
        alt={photo.caption}
        video={video}
      />
      {video && (
        <span className="photo-gallery__video-badge" aria-hidden>
          <Play className="h-3.5 w-3.5 fill-current" />
        </span>
      )}
    </button>
    <button
      type="button"
      className="photo-gallery__tile-delete"
      onClick={(event) => {
        event.stopPropagation();
        onDelete();
      }}
      aria-label={`Supprimer ${photo.caption || (video ? 'la vidéo' : 'la photo')}`}
      title="Supprimer"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
    <div className="photo-gallery__tile-caption">
      <p>{photo.caption?.trim() || (video ? 'Vidéo de route' : 'Souvenir de route')}</p>
      <span style={author?.color ? { color: author.color } : undefined}>
        {author?.name || 'Équipage'} · {photo.date}
      </span>
    </div>
  </article>
  );
};

interface JournalAndPhotosProps {
  notes: JournalNote[];
  photos: TripPhoto[];
  friends: Friend[];
  currentFriendId: string;
  authorId: string;
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
  authorId,
  userLocation,
  onAddNote,
  onAddPhoto,
  onDeletePhoto,
}) => {
  const [activeTab, setActiveTab] = useState<'journal' | 'photos' | 'videos'>('journal');
  const [selectedFriendFilter, setSelectedFriendFilter] = useState<string>('all');
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [selectedPhotoPreview, setSelectedPhotoPreview] = useState<TripPhoto | null>(null);
  const [photoToDelete, setPhotoToDelete] = useState<TripPhoto | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedVideoAlbumId, setSelectedVideoAlbumId] = useState<string | null>(null);
  const [mediaUploadError, setMediaUploadError] = useState('');

  // New Note Form State
  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [noteLocation, setNoteLocation] = useState('');
  const [noteCoords, setNoteCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [notePhotoUrl, setNotePhotoUrl] = useState('');

  // New Photo Form State
  const [photoUrlInput, setPhotoUrlInput] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoLocation, setPhotoLocation] = useState('');
  const [photoCoords, setPhotoCoords] = useState<{ lat: number; lng: number } | null>(null);

  // New Video Form State
  const [videoUrlInput, setVideoUrlInput] = useState('');
  const [videoCaption, setVideoCaption] = useState('');
  const [videoLocation, setVideoLocation] = useState('');
  const [videoCoords, setVideoCoords] = useState<{ lat: number; lng: number } | null>(null);

  const handleCreateNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;

    onAddNote({
      title: noteTitle.trim(),
      content: noteContent.trim(),
      date: new Date().toISOString().split('T')[0],
      friendId: authorId,
      locationName: noteLocation.trim(),
      lat: noteCoords?.lat,
      lng: noteCoords?.lng,
      photos: notePhotoUrl.trim() ? [notePhotoUrl.trim()] : []
    });

    setNoteTitle('');
    setNoteContent('');
    setNoteLocation('');
    setNoteCoords(null);
    setNotePhotoUrl('');
    setShowNoteModal(false);
  };

  const handleCreatePhoto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoUrlInput.trim()) return;

    onAddPhoto({
      url: photoUrlInput.trim(),
      caption: photoCaption.trim(),
      date: new Date().toISOString().split('T')[0],
      friendId: authorId,
      locationName: photoLocation.trim(),
      lat: photoCoords?.lat,
      lng: photoCoords?.lng,
      mediaType: 'photo',
    });

    setPhotoUrlInput('');
    setPhotoCaption('');
    setPhotoLocation('');
    setPhotoCoords(null);
    setMediaUploadError('');
    setShowPhotoModal(false);
  };

  const handleCreateVideo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrlInput.trim()) return;

    onAddPhoto({
      url: videoUrlInput.trim(),
      caption: videoCaption.trim(),
      date: new Date().toISOString().split('T')[0],
      friendId: authorId,
      locationName: videoLocation.trim(),
      lat: videoCoords?.lat,
      lng: videoCoords?.lng,
      mediaType: 'video',
    });

    setVideoUrlInput('');
    setVideoCaption('');
    setVideoLocation('');
    setVideoCoords(null);
    setMediaUploadError('');
    setShowVideoModal(false);
  };

  const closeNoteModal = () => {
    setNoteTitle('');
    setNoteContent('');
    setNoteLocation('');
    setNoteCoords(null);
    setNotePhotoUrl('');
    setShowNoteModal(false);
  };

  const closePhotoModal = () => {
    setPhotoUrlInput('');
    setPhotoCaption('');
    setPhotoLocation('');
    setPhotoCoords(null);
    setMediaUploadError('');
    setShowPhotoModal(false);
  };

  const closeVideoModal = () => {
    setVideoUrlInput('');
    setVideoCaption('');
    setVideoLocation('');
    setVideoCoords(null);
    setMediaUploadError('');
    setShowVideoModal(false);
  };

  const handleVideoFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setMediaUploadError('');
    try {
      const dataUrl = await fileToVideoDataUrl(file);
      setVideoUrlInput(dataUrl);
    } catch (err) {
      setMediaUploadError(err instanceof Error ? err.message : 'Impossible de lire cette vidéo.');
    } finally {
      e.target.value = '';
    }
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

  const galleryPhotos = filteredPhotos.filter((photo) => !isVideoMedia(photo));
  const galleryVideos = filteredPhotos.filter((photo) => isVideoMedia(photo));

  const photoAlbums = groupPhotosIntoAlbums(galleryPhotos, friends, 'location');
  const videoAlbums = groupPhotosIntoAlbums(galleryVideos, friends, 'location');
  const selectedAlbum = photoAlbums.find((album) => album.id === selectedAlbumId) ?? null;
  const selectedVideoAlbum = videoAlbums.find((album) => album.id === selectedVideoAlbumId) ?? null;

  useEffect(() => {
    setSelectedAlbumId(null);
    setSelectedVideoAlbumId(null);
  }, [selectedFriendFilter]);

  const previewAuthor = selectedPhotoPreview
    ? friends.find((f) => f.id === selectedPhotoPreview.friendId)
    : undefined;
  const previewIsVideo = selectedPhotoPreview ? isVideoMedia(selectedPhotoPreview) : false;

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
            <button
              type="button"
              onClick={() => setActiveTab('videos')}
              className={`min-h-10 flex-1 sm:flex-none justify-center px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                activeTab === 'videos'
                  ? 'bg-white text-zinc-900 shadow-xs'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              <Video className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
              <span>Vidéos</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              if (activeTab === 'journal') {
                setShowNoteModal(true);
              } else if (activeTab === 'videos') {
                setShowVideoModal(true);
              } else {
                setShowPhotoModal(true);
              }
            }}
            className="min-h-11 w-full sm:w-auto justify-center rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white shadow-xs transition-all font-bold text-xs flex items-center gap-1.5 px-4 py-2.5"
          >
            <Plus className="w-4 h-4 text-emerald-400" />{' '}
            {activeTab === 'journal' ? 'Note' : activeTab === 'videos' ? 'Vidéo' : 'Photo'}
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
        <div className="photo-gallery">
          {galleryPhotos.length === 0 ? (
            <div className="bg-white rounded-[2rem] p-8 text-center text-zinc-400 border border-zinc-200 text-xs font-medium">
              Aucune photo disponible. Ajoute ta première photo de van !
            </div>
          ) : (
            <>
              <div className="photo-gallery__hero">
                <div className="photo-gallery__hero-glow" aria-hidden />
                <div className="relative">
                  <h2 className="photo-gallery__hero-title">Galerie du road trip</h2>
                  <p className="photo-gallery__hero-sub">
                    {mediaCountLabel(galleryPhotos)} · {photoAlbums.length} lieu{photoAlbums.length > 1 ? 'x' : ''}
                  </p>
                </div>
              </div>

              {!selectedAlbum ? (
                <div className="photo-gallery__folders">
                  {photoAlbums.map((album) => (
                    <PhotoFolderCard
                      key={album.id}
                      album={album}
                      onOpen={() => setSelectedAlbumId(album.id)}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="photo-gallery__breadcrumb">
                    <button
                      type="button"
                      className="photo-gallery__back"
                      onClick={() => setSelectedAlbumId(null)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Dossiers
                    </button>
                    <span className="photo-gallery__crumb-current">
                      {selectedAlbum.emoji} {selectedAlbum.title}
                    </span>
                  </div>

                  <div className="photo-gallery__album-banner">
                    {selectedAlbum.photos[0]?.url && (
                      <div
                        className="photo-gallery__album-banner-bg"
                        style={{ backgroundImage: `url(${selectedAlbum.photos[0].url})` }}
                        aria-hidden
                      />
                    )}
                    <div className="photo-gallery__album-banner-content">
                      <span className="photo-gallery__album-banner-emoji" aria-hidden>
                        {selectedAlbum.emoji}
                      </span>
                      <div className="min-w-0">
                        <h3 className="photo-gallery__album-banner-title">{selectedAlbum.title}</h3>
                        <p className="photo-gallery__album-banner-count">
                          {selectedAlbum.photos.length} photo
                          {selectedAlbum.photos.length > 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="photo-gallery__grid">
                    {selectedAlbum.photos.map((photo, index) => {
                      const author = friends.find((f) => f.id === photo.friendId);
                      return (
                        <PhotoGalleryTile
                          key={photo.id}
                          photo={photo}
                          author={author}
                          featured={index === 0}
                          onOpen={() => setSelectedPhotoPreview(photo)}
                          onDelete={() => setPhotoToDelete(photo)}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* VIDEOS GALLERY TAB */}
      {activeTab === 'videos' && (
        <div className="photo-gallery">
          {galleryVideos.length === 0 ? (
            <div className="bg-white rounded-[2rem] p-8 text-center text-zinc-400 border border-zinc-200 text-xs font-medium">
              Aucune vidéo disponible. Filme un moment du voyage !
            </div>
          ) : (
            <>
              <div className="photo-gallery__hero">
                <div className="photo-gallery__hero-glow" aria-hidden />
                <div className="relative">
                  <h2 className="photo-gallery__hero-title">Vidéos du road trip</h2>
                  <p className="photo-gallery__hero-sub">
                    {mediaCountLabel(galleryVideos)} · {videoAlbums.length} lieu{videoAlbums.length > 1 ? 'x' : ''}
                  </p>
                </div>
              </div>

              {!selectedVideoAlbum ? (
                <div className="photo-gallery__folders">
                  {videoAlbums.map((album) => (
                    <PhotoFolderCard
                      key={album.id}
                      album={album}
                      onOpen={() => setSelectedVideoAlbumId(album.id)}
                    />
                  ))}
                </div>
              ) : (
                <>
                  <div className="photo-gallery__breadcrumb">
                    <button
                      type="button"
                      className="photo-gallery__back"
                      onClick={() => setSelectedVideoAlbumId(null)}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Dossiers
                    </button>
                    <span className="photo-gallery__crumb-current">
                      {selectedVideoAlbum.emoji} {selectedVideoAlbum.title}
                    </span>
                  </div>

                  <div className="photo-gallery__album-banner">
                    {selectedVideoAlbum.photos[0]?.url && (
                      <div className="photo-gallery__album-banner-bg photo-gallery__album-banner-bg--video" aria-hidden>
                        <video
                          src={selectedVideoAlbum.photos[0].url}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover opacity-40"
                        />
                      </div>
                    )}
                    <div className="photo-gallery__album-banner-content">
                      <span className="photo-gallery__album-banner-emoji" aria-hidden>
                        {selectedVideoAlbum.emoji}
                      </span>
                      <div className="min-w-0">
                        <h3 className="photo-gallery__album-banner-title">{selectedVideoAlbum.title}</h3>
                        <p className="photo-gallery__album-banner-count">
                          {mediaCountLabel(selectedVideoAlbum.photos)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="photo-gallery__grid">
                    {selectedVideoAlbum.photos.map((photo, index) => {
                      const author = friends.find((f) => f.id === photo.friendId);
                      return (
                        <PhotoGalleryTile
                          key={photo.id}
                          photo={photo}
                          author={author}
                          featured={index === 0}
                          onOpen={() => setSelectedPhotoPreview(photo)}
                          onDelete={() => setPhotoToDelete(photo)}
                        />
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      <SimpleFormModal
        isOpen={showNoteModal}
        onClose={closeNoteModal}
        title="Nouvelle note"
        subtitle="Titre · lieu · récit"
        icon={<BookOpen className="h-4 w-4" />}
        titleId="add-note-title"
        onSubmit={handleCreateNote}
        footer={
          <FormModalFooter
            onCancel={closeNoteModal}
            submitLabel="Publier"
            canSubmit={Boolean(noteTitle.trim() && noteContent.trim())}
          />
        }
      >
        <CompactFormRoot>
          <CompactFormHero>
            <CompactFormField label="Titre *" tone="hero">
              <CompactFormTextInput
                tone="hero"
                required
                placeholder="Apéro du soir, galère de route…"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                className="font-extrabold"
              />
            </CompactFormField>
            <CompactFormField label="Lieu" tone="hero">
              <CompactFormTextInput
                tone="hero"
                placeholder="Lac, bord de mer…"
                value={noteLocation}
                onChange={(e) => setNoteLocation(e.target.value)}
              />
            </CompactFormField>
          </CompactFormHero>

          <CompactFormSection>
            <CompactFormField label="Récit *">
              <CompactFormTextarea
                required
                rows={3}
                placeholder="Raconte la journée…"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
            </CompactFormField>
            <CompactFormField label="Photo">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFileSelect(e, true)}
                className="w-full text-[10px] text-[#68756d] file:mr-2 file:rounded-lg file:border-0 file:bg-white file:px-2 file:py-1 file:text-[10px] file:font-bold file:text-[#17352b]"
              />
              {notePhotoUrl && (
                <img
                  src={notePhotoUrl}
                  alt=""
                  className="mt-1.5 h-20 w-full rounded-lg border border-[#17352b]/10 object-cover"
                />
              )}
            </CompactFormField>
          </CompactFormSection>
        </CompactFormRoot>
      </SimpleFormModal>

      <SimpleFormModal
        isOpen={showPhotoModal}
        onClose={closePhotoModal}
        title="Ajouter une photo"
        subtitle="Image · légende · lieu"
        icon={<Camera className="h-4 w-4" />}
        titleId="add-photo-title"
        onSubmit={handleCreatePhoto}
        footer={
          <FormModalFooter
            onCancel={closePhotoModal}
            submitLabel="Ajouter"
            canSubmit={Boolean(photoUrlInput.trim())}
          />
        }
      >
        <CompactFormRoot>
          <CompactFormHero>
            <CompactFormField label="Photo *" tone="hero">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFileSelect(e, false)}
                className="w-full text-[10px] text-white/70 file:mr-2 file:rounded-lg file:border-0 file:bg-white/15 file:px-2 file:py-1 file:text-[10px] file:font-bold file:text-white"
              />
              <CompactFormTextInput
                tone="hero"
                placeholder="ou URL d'image…"
                value={photoUrlInput.startsWith('data:') ? '' : photoUrlInput}
                onChange={(e) => setPhotoUrlInput(e.target.value)}
                className="mt-1.5 border-white/15"
              />
              {photoUrlInput && (
                <img
                  src={photoUrlInput}
                  alt=""
                  className="mt-1.5 h-24 w-full rounded-lg border border-white/15 object-cover"
                />
              )}
            </CompactFormField>
          </CompactFormHero>

          <CompactFormSection>
            <CompactFormField label="Légende">
              <CompactFormTextInput
                placeholder="Coucher de soleil, vue du van…"
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
              />
            </CompactFormField>
            <CompactFormField label="Lieu">
              <CompactFormTextInput
                placeholder="Col, plage, spot…"
                value={photoLocation}
                onChange={(e) => setPhotoLocation(e.target.value)}
              />
            </CompactFormField>
          </CompactFormSection>
        </CompactFormRoot>
      </SimpleFormModal>

      <SimpleFormModal
        isOpen={showVideoModal}
        onClose={closeVideoModal}
        title="Ajouter une vidéo"
        subtitle="Fichier · légende · lieu"
        icon={<Video className="h-4 w-4" />}
        titleId="add-video-title"
        onSubmit={handleCreateVideo}
        footer={
          <FormModalFooter
            onCancel={closeVideoModal}
            submitLabel="Ajouter"
            canSubmit={Boolean(videoUrlInput.trim())}
          />
        }
      >
        <CompactFormRoot>
          <CompactFormHero>
            <CompactFormField label="Vidéo *" tone="hero">
              <input
                type="file"
                accept="video/*"
                onChange={(e) => void handleVideoFileSelect(e)}
                className="w-full text-[10px] text-white/70 file:mr-2 file:rounded-lg file:border-0 file:bg-white/15 file:px-2 file:py-1 file:text-[10px] file:font-bold file:text-white"
              />
              {mediaUploadError && (
                <p className="mt-1.5 text-[10px] font-bold text-red-200">{mediaUploadError}</p>
              )}
              {videoUrlInput && (
                <video
                  src={videoUrlInput}
                  controls
                  playsInline
                  className="mt-1.5 max-h-40 w-full rounded-lg border border-white/15 bg-black/40"
                />
              )}
            </CompactFormField>
          </CompactFormHero>

          <CompactFormSection>
            <CompactFormField label="Légende">
              <CompactFormTextInput
                placeholder="Bivouac, route, coucher de soleil…"
                value={videoCaption}
                onChange={(e) => setVideoCaption(e.target.value)}
              />
            </CompactFormField>
            <CompactFormField label="Lieu">
              <CompactFormTextInput
                placeholder="Col, plage, spot…"
                value={videoLocation}
                onChange={(e) => setVideoLocation(e.target.value)}
              />
            </CompactFormField>
          </CompactFormSection>
        </CompactFormRoot>
      </SimpleFormModal>

      {/* Immersive media viewer */}
      {selectedPhotoPreview && (
        <div
          className="fixed inset-0 z-[180] flex flex-col bg-zinc-950/95 backdrop-blur-xl"
          role="dialog"
          aria-modal="true"
          aria-label={selectedPhotoPreview.caption || (previewIsVideo ? 'Aperçu vidéo' : 'Aperçu photo')}
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
            {previewIsVideo ? (
              <video
                src={selectedPhotoPreview.url}
                controls
                autoPlay
                playsInline
                className="relative z-10 max-h-full max-w-full rounded-lg bg-black shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
              />
            ) : (
              <img
                src={selectedPhotoPreview.url}
                alt={selectedPhotoPreview.caption || 'Photo du voyage'}
                className="relative z-10 max-h-full max-w-full rounded-lg object-contain shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
          </div>

          <div
            className="relative px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-x-0 -top-16 h-16 bg-gradient-to-t from-zinc-950 to-transparent" />
            <div className="relative mx-auto w-full max-w-lg space-y-3">
              <h3 className="text-lg font-extrabold leading-snug text-white">
                {selectedPhotoPreview.caption?.trim() || (previewIsVideo ? 'Vidéo de route' : 'Souvenir de route')}
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
                {previewIsVideo ? 'Supprimer cette vidéo' : 'Supprimer cette photo'}
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
            <h3 className="text-base font-extrabold text-[#17352b]">
              Supprimer {photoToDelete && isVideoMedia(photoToDelete) ? 'cette vidéo' : 'cette photo'} ?
            </h3>
            <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-[#68756d]">
              « {photoToDelete?.caption?.trim() || (photoToDelete && isVideoMedia(photoToDelete) ? 'Vidéo de route' : 'Souvenir de route')} » sera supprimée de la galerie pour tout l’équipage.
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

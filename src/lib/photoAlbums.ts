import type { Friend, TripPhoto } from '../types';
import { mediaCountLabel } from './mediaUtils';

export type PhotoAlbumGroupMode = 'location' | 'author';

export interface PhotoAlbum {
  id: string;
  title: string;
  subtitle?: string;
  emoji: string;
  photos: TripPhoto[];
  sortKey: string;
}

function locationEmoji(name: string) {
  const haystack = name.toLowerCase();
  if (/mer|plage|beach|océan/.test(haystack)) return '🏖️';
  if (/mont|col|alpe|sommet/.test(haystack)) return '⛰️';
  if (/lac|rivière|fleuve/.test(haystack)) return '🏞️';
  if (/ville|paris|lille|lyon/.test(haystack)) return '🏙️';
  if (/van|camp|bivouac|aire/.test(haystack)) return '🚐';
  return '📍';
}

export function groupPhotosIntoAlbums(
  photos: TripPhoto[],
  friends: Friend[],
  mode: PhotoAlbumGroupMode
): PhotoAlbum[] {
  const buckets = new Map<string, PhotoAlbum>();

  for (const photo of photos) {
    let id: string;
    let title: string;
    let subtitle: string | undefined;
    let emoji: string;
    let sortKey: string;

    if (mode === 'location') {
      const place = photo.locationName?.trim() || 'Sans lieu';
      id = `loc:${place.toLowerCase()}`;
      title = place;
      emoji = place === 'Sans lieu' ? '🗺️' : locationEmoji(place);
      sortKey = place.toLowerCase();
    } else {
      const friend = friends.find((f) => f.id === photo.friendId);
      const name = friend?.name || 'Équipage';
      id = `author:${photo.friendId}`;
      title = name;
      subtitle = friend ? 'Photos partagées' : undefined;
      emoji = '📸';
      sortKey = name.toLowerCase();
    }

    const existing = buckets.get(id);
    if (existing) {
      existing.photos.push(photo);
    } else {
      buckets.set(id, {
        id,
        title,
        subtitle,
        emoji,
        photos: [photo],
        sortKey,
      });
    }
  }

  const albums = Array.from(buckets.values());

  for (const album of albums) {
    album.photos.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    album.subtitle =
      album.subtitle ||
      mediaCountLabel(album.photos);
  }

  return albums.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
}

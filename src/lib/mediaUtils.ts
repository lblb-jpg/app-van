import type { TripPhoto } from '../types';

export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

export function inferMediaType(url: string, storagePath?: string | null): 'photo' | 'video' {
  if (/^data:video\//i.test(url)) return 'video';
  const source = storagePath || url;
  if (/\.(mp4|webm|mov|m4v|quicktime)(\?|$)/i.test(source)) return 'video';
  return 'photo';
}

export function isVideoMedia(photo: Pick<TripPhoto, 'url' | 'mediaType'>) {
  if (photo.mediaType === 'video') return true;
  if (photo.mediaType === 'photo') return false;
  return inferMediaType(photo.url) === 'video';
}

export async function fileToVideoDataUrl(file: File, maxBytes = MAX_VIDEO_BYTES): Promise<string> {
  if (!file.type.startsWith('video/')) {
    throw new Error('Choisis un fichier vidéo.');
  }
  if (file.size > maxBytes) {
    throw new Error(`Vidéo trop lourde (max ${Math.round(maxBytes / (1024 * 1024))} Mo).`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('Lecture vidéo impossible'));
    };
    reader.onerror = () => reject(new Error('Lecture vidéo impossible'));
    reader.readAsDataURL(file);
  });
}

export function mediaCountLabel(photos: TripPhoto[]) {
  const videos = photos.filter(isVideoMedia).length;
  const images = photos.length - videos;
  const parts: string[] = [];
  if (images) parts.push(`${images} photo${images > 1 ? 's' : ''}`);
  if (videos) parts.push(`${videos} vidéo${videos > 1 ? 's' : ''}`);
  return parts.join(' · ') || '0 média';
}

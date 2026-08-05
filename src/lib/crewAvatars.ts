import { CREW_MEMBER_NAMES, type CrewMemberName } from '../services/supabase';

export const CREW_DEFAULT_AVATARS: Record<CrewMemberName, string> = {
  Adel: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=256&auto=format&fit=crop&q=80',
  Paul: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=256&auto=format&fit=crop&q=80',
  Yanis: 'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=256&auto=format&fit=crop&q=80',
};

export const CREW_DEFAULT_COLORS: Record<CrewMemberName, string> = {
  Adel: '#059669',
  Paul: '#2563eb',
  Yanis: '#9333ea',
};

const LEGACY_CREW_IDS: Record<string, CrewMemberName> = {
  adel: 'Adel',
  paul: 'Paul',
  yanis: 'Yanis',
};

export type CrewCustomization = { name?: string; avatar?: string };

export function makeInitialAvatar(name: string, background: string) {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${background}"/><text x="48" y="58" text-anchor="middle" font-family="Arial, sans-serif" font-size="36" font-weight="700" fill="white">${name.slice(0, 1).toUpperCase()}</text></svg>`
  )}`;
}

export function matchCrewMemberName(name: string): CrewMemberName | undefined {
  return CREW_MEMBER_NAMES.find((member) => member.toLowerCase() === name.trim().toLowerCase());
}

export function isPlaceholderAvatar(url?: string | null) {
  if (!url?.trim()) return true;
  return url.startsWith('data:image/svg');
}

/** Photo réelle = URL http(s) ou data JPEG/PNG (pas le SVG initiales). */
export function isRealAvatar(url?: string | null) {
  if (!url?.trim()) return false;
  if (isPlaceholderAvatar(url)) return false;
  return (
    url.startsWith('http://') ||
    url.startsWith('https://') ||
    url.startsWith('data:image/jpeg') ||
    url.startsWith('data:image/png') ||
    url.startsWith('data:image/webp') ||
    url.startsWith('blob:')
  );
}

export function resolveFriendAvatar(name: string, color: string, avatarUrl?: string | null) {
  if (isRealAvatar(avatarUrl)) return avatarUrl as string;
  const crewName = matchCrewMemberName(name);
  if (crewName) return CREW_DEFAULT_AVATARS[crewName];
  return makeInitialAvatar(name, color);
}

/** Prefers cloud photo; local customization only if cloud has nothing real. */
export function pickDisplayAvatar(
  cloudAvatar: string | undefined | null,
  localAvatar: string | undefined | null,
  name: string,
  color: string
) {
  if (isRealAvatar(cloudAvatar)) return cloudAvatar as string;
  if (isRealAvatar(localAvatar)) return localAvatar as string;
  return resolveFriendAvatar(name, color, null);
}

export function readCrewCustomization(
  store: Record<string, CrewCustomization>,
  friendId: string,
  crewName: CrewMemberName
): CrewCustomization | undefined {
  return (
    store[friendId] ||
    store[crewName] ||
    store[crewName.toLowerCase()] ||
    (LEGACY_CREW_IDS[friendId] ? store[LEGACY_CREW_IDS[friendId]] : undefined)
  );
}

export function hydrateFriendAvatars<T extends { name: string; color: string; avatar: string }>(
  friends: T[]
): T[] {
  return friends.map((friend) => ({
    ...friend,
    avatar: resolveFriendAvatar(friend.name, friend.color, friend.avatar),
  }));
}

export async function fileToAvatarDataUrl(file: File, maxSize = 256): Promise<string> {
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
    return canvas.toDataURL('image/jpeg', 0.86);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function writeCrewCustomization(
  store: Record<string, CrewCustomization>,
  friendId: string,
  crewName: CrewMemberName | undefined,
  patch: CrewCustomization
): Record<string, CrewCustomization> {
  const next: Record<string, CrewCustomization> = {
    ...store,
    [friendId]: { ...store[friendId], ...patch },
  };
  if (crewName) {
    next[crewName] = { ...next[crewName], ...patch };
    next[crewName.toLowerCase()] = { ...next[crewName.toLowerCase()], ...patch };
  }
  return next;
}

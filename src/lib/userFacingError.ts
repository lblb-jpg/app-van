/** Map technical/backend errors to short, non-sensitive UI copy. */
export function toUserFacingError(error: unknown, fallback = 'Action impossible pour le moment.') {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '';

  const message = raw.toLowerCase();

  if (!message) return fallback;

  // Real auth expiry only — never match "author_id", "Session cloud…", etc.
  if (isAuthExpiryMessage(message)) {
    return 'Reconnexion en cours…';
  }

  if (message.includes('row-level security') || message.includes('42501')) {
    return 'Action non autorisée sur ce voyage. Change de profil ou réessaie.';
  }
  if (message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')) {
    return 'Pas de connexion. Tes données restent en local.';
  }
  if (message.includes('rate limit') || message.includes('too many')) {
    return 'Trop de tentatives. Réessaie dans un instant.';
  }
  if (message.includes('supabase non configuré')) {
    return 'Cloud non configuré. Mode local actif.';
  }
  if (message.includes('schéma supabase incomplet') || message.includes('sync partielle')) {
    return raw;
  }
  if (message.includes('share_count') || message.includes('split_amount') || message.includes('split_type')) {
    return 'Base Supabase à mettre à jour. Exécute supabase/ensure_full_sync.sql puis recharge l’app.';
  }
  if (
    message.includes('mime') ||
    message.includes('not allowed') ||
    message.includes('invalid file') ||
    message.includes('payload too large') ||
    message === '400' ||
    message.includes('status 400') ||
    message.includes('bad request')
  ) {
    return 'Upload vidéo refusé par Supabase. Exécute supabase/add_video_storage.sql dans le SQL Editor, puis réessaie.';
  }
  if (message.includes('indique un prénom') || message.includes('prénom')) {
    return 'Indique un prénom pour continuer.';
  }

  // Never surface raw postgres / API payloads.
  if (
    message.includes('violates') ||
    message.includes('permission') ||
    message.includes('policy') ||
    message.includes('pgrst') ||
    message.includes('postgres') ||
    message.includes('uuid') ||
    message.includes('apikey') ||
    /https?:\/\//.test(message)
  ) {
    return fallback;
  }

  // Keep short, already-friendly French product messages.
  if (raw.length <= 90 && !/[{\\[\]_]/.test(raw)) {
    return raw;
  }

  return fallback;
}

/** True when Supabase rejected the JWT / refresh token. */
export function isAuthExpiryError(error: unknown): boolean {
  const raw =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message || '')
        : '';
  return isAuthExpiryMessage(raw.toLowerCase());
}

function isAuthExpiryMessage(message: string) {
  return (
    message.includes('jwt expired') ||
    message.includes('invalid jwt') ||
    message.includes('invalid_grant') ||
    message.includes('refresh_token') ||
    message.includes('session missing') ||
    message.includes('session not found') ||
    message.includes('not authenticated') ||
    message.includes('invalid claim') ||
    message.includes('token is expired') ||
    /auth session missing/.test(message)
  );
}

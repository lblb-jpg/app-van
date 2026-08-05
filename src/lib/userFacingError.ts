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
  if (message.includes('row-level security') || message.includes('42501')) {
    return 'Synchronisation refusée. Reconnecte-toi puis réessaie.';
  }
  if (message.includes('jwt') || message.includes('session') || message.includes('auth')) {
    return 'Session expirée. Reconnecte-toi pour continuer.';
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

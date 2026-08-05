-- Autorise les vidéos dans le bucket trip-photos (à exécuter si upload vidéo → erreur 400).
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v',
    'video/mov'
  ]
where id = 'trip-photos';

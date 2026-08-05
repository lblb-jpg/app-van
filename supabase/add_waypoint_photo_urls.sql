-- Ajoute le support photos sur les étapes (à exécuter si la table existe déjà)
alter table public.waypoints
  add column if not exists photo_urls text[] not null default '{}';

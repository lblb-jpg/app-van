# Supabase — Vanlife Club

## Setup

1. Crée un projet Supabase et copie URL + clé anon dans `.env.local`.
2. SQL Editor → exécute **dans l’ordre** :
   - `schema.sql` *(projet neuf)* **ou** `vanlife_on_shared.sql` *(base partagée)*
   - `ensure_full_sync.sql` *(obligatoire : photos, invite, storage, realtime)*
3. Auth → active **Email** (et **Anonymous** si connexion rapide).

Scripts utilitaires :

- `live_locations_and_invite.sql` — positions live + codes d’invitation
- `add_waypoint_photo_urls.sql` — photos sur les étapes
- `reset_data_keep_users.sql` — reset données, conserve les users

## Sync

| Domaine | Sync |
|---------|------|
| Équipage / profils | Oui |
| POIs carte | Oui |
| Étapes + photos | Oui |
| Journal & galerie | Oui (Storage `trip-photos`) |
| Dépenses | Oui |
| Traces GPS | Oui |
| Positions live | Oui |
| Code invitation | Oui |

Au démarrage, le local non-UUID est poussé vers le cloud, puis Supabase devient la source de vérité.

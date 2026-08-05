# Supabase — VanLife sync

## Setup (une fois)

1. Crée / ouvre le projet Supabase (même URL que `VITE_SUPABASE_URL` dans `.env.local`).
2. SQL Editor → exécute **dans l’ordre** :
   - `vanlife_on_shared.sql` *(si le projet partage déjà une base, ex. Livret)*  
     **ou** `schema.sql` *(projet greenfield)*
   - `ensure_full_sync.sql` ← **obligatoire** (photos étapes, invite, bucket public, realtime)
3. Auth → active **Email** (+ **Anonymous** si tu utilises la connexion rapide).
4. Crée les comptes équipage Adel / Paul / Yanis (ou laisse l’app les créer via le serveur).

## Ce qui est synchronisé

| Domaine | Sync |
|---------|------|
| Équipage / profils | Oui |
| POIs carte | Oui (push + live) |
| Étapes + photos | Oui |
| Journal | Oui |
| Galerie photos | Oui (Storage `trip-photos`) |
| Dépenses | Oui |
| Traces GPS | Oui |
| Positions live | Oui (`member_locations`) |
| Code invitation | Oui (`join_trip_by_code`) |

Au démarrage, l’app appelle `syncLocalDataToCloud` : tout ce qui est encore local (IDs non-UUID) est poussé vers Supabase, puis l’état cloud devient la source de vérité.

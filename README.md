# Vanlife Club

PWA mobile-first pour road trip en van : carte, étapes, journal & budget partagé.

## Stack

- React 19 + Vite + TypeScript
- Tailwind CSS 4
- Supabase (auth, sync, realtime, storage)
- Leaflet (carte)
- Express (API locale / Vercel)

## Démarrage

```bash
npm install
cp .env.example .env.local
# Remplis VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY
npm run dev
```

Ouvre [http://localhost:3000](http://localhost:3000).

## Variables d’environnement

Copie `.env.example` → `.env.local` (jamais committer `.env.local`).

| Variable | Rôle |
|----------|------|
| `VITE_SUPABASE_URL` | URL du projet Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clé publishable (client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Optionnel, serveur uniquement |

## Scripts

| Commande | Description |
|----------|-------------|
| `npm run dev` | Dev (Vite + Express) |
| `npm run build` | Build production |
| `npm start` | Lance le build |
| `npm run lint` | Typecheck |

## Supabase

Voir [`supabase/README.md`](supabase/README.md) pour le schéma SQL et l’ordre d’exécution.

## Fonctionnalités

- **Carte** — spots, équipage live
- **Dormir** — recherche de spots van
- **Étapes** — itinéraire, statuts, photos
- **Journal** — notes & galerie
- **VanPay** — dépenses type Tricount

## Licence

Privé — usage personnel / équipage.

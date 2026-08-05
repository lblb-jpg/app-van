-- Vanlife Road Trip: schéma Supabase complet
-- À exécuter en une fois dans Supabase > SQL Editor.
-- Chaque voyage est isolé, et seuls ses membres peuvent accéder à ses données.

create extension if not exists "pgcrypto";

create type public.trip_member_role as enum ('owner', 'editor', 'viewer');
create type public.poi_type as enum ('van_spot', 'camping', 'water', 'viewpoint', 'hike', 'fuel', 'food', 'other');
create type public.waypoint_status as enum ('done', 'active', 'upcoming');
create type public.expense_category as enum ('carburant', 'peage', 'courses', 'resto', 'activite', 'autre');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Voyageur',
  avatar_url text,
  color text not null default '#059669',
  role_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  starts_on date,
  ends_on date,
  owner_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  invite_code text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.trip_members (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  member_role public.trip_member_role not null default 'editor',
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table public.pois (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  title text not null,
  description text,
  type public.poi_type not null default 'other',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  photo_url text,
  amenities text[] not null default '{}',
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.waypoints (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  position integer not null check (position >= 0),
  title text not null,
  location_name text not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  scheduled_on date,
  status public.waypoint_status not null default 'upcoming',
  notes text,
  van_spot_type text,
  amenities text[] not null default '{}',
  photo_urls text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, position)
);

create table public.journal_notes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  title text not null,
  content text not null,
  happened_on date not null default current_date,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  location_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  journal_note_id uuid references public.journal_notes(id) on delete set null,
  storage_path text not null,
  caption text,
  taken_on date not null default current_date,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  location_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  category public.expense_category not null default 'autre',
  spent_on date not null default current_date,
  paid_by uuid not null references public.profiles(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expense_splits (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (expense_id, user_id)
);

create table public.gps_tracks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  title text not null,
  tracked_on date not null default current_date,
  started_at timestamptz not null,
  ended_at timestamptz,
  distance_km numeric(10,2) not null default 0 check (distance_km >= 0),
  avg_speed_kmh numeric(8,2) not null default 0 check (avg_speed_kmh >= 0),
  max_speed_kmh numeric(8,2) not null default 0 check (max_speed_kmh >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create table public.gps_track_points (
  id bigint generated always as identity primary key,
  track_id uuid not null references public.gps_tracks(id) on delete cascade,
  recorded_at timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  altitude_m double precision,
  speed_kmh double precision check (speed_kmh is null or speed_kmh >= 0),
  unique (track_id, recorded_at)
);

create table public.member_locations (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  altitude_m double precision,
  battery smallint check (battery between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index on public.trip_members (user_id, trip_id);
create index on public.pois (trip_id, created_at desc);
create index on public.waypoints (trip_id, position);
create index on public.journal_notes (trip_id, happened_on desc);
create index on public.photos (trip_id, taken_on desc);
create index on public.expenses (trip_id, spent_on desc);
create index on public.gps_tracks (trip_id, tracked_on desc);
create index on public.gps_track_points (track_id, recorded_at);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Voyageur'), new.raw_user_meta_data ->> 'avatar_url');
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.add_trip_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.trip_members (trip_id, user_id, member_role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger on_trip_created after insert on public.trips for each row execute procedure public.add_trip_owner();

create or replace function public.is_trip_member(target_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = target_trip and user_id = auth.uid());
$$;

create or replace function public.is_trip_editor(target_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = target_trip and user_id = auth.uid() and member_role in ('owner', 'editor'));
$$;

create or replace function public.is_trip_owner(target_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trip_members where trip_id = target_trip and user_id = auth.uid() and member_role = 'owner');
$$;

create trigger set_profiles_updated_at before update on public.profiles for each row execute procedure public.set_updated_at();
create trigger set_trips_updated_at before update on public.trips for each row execute procedure public.set_updated_at();
create trigger set_pois_updated_at before update on public.pois for each row execute procedure public.set_updated_at();
create trigger set_waypoints_updated_at before update on public.waypoints for each row execute procedure public.set_updated_at();
create trigger set_journal_notes_updated_at before update on public.journal_notes for each row execute procedure public.set_updated_at();
create trigger set_photos_updated_at before update on public.photos for each row execute procedure public.set_updated_at();
create trigger set_expenses_updated_at before update on public.expenses for each row execute procedure public.set_updated_at();
create trigger set_gps_tracks_updated_at before update on public.gps_tracks for each row execute procedure public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_members enable row level security;
alter table public.pois enable row level security;
alter table public.waypoints enable row level security;
alter table public.journal_notes enable row level security;
alter table public.photos enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.gps_tracks enable row level security;
alter table public.gps_track_points enable row level security;
alter table public.member_locations enable row level security;

create policy "authenticated users read profiles" on public.profiles for select to authenticated using (true);
create policy "users update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "users insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());

create policy "members read trips" on public.trips for select to authenticated using (public.is_trip_member(id));
create policy "users create trips" on public.trips for insert to authenticated with check (owner_id = auth.uid());
create policy "owners update trips" on public.trips for update to authenticated using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));
create policy "owners delete trips" on public.trips for delete to authenticated using (public.is_trip_owner(id));

create policy "members read crew" on public.trip_members for select to authenticated using (public.is_trip_member(trip_id));
create policy "owners manage crew" on public.trip_members for all to authenticated using (public.is_trip_owner(trip_id)) with check (public.is_trip_owner(trip_id));

create policy "members read pois" on public.pois for select to authenticated using (public.is_trip_member(trip_id));
create policy "editors create pois" on public.pois for insert to authenticated with check (public.is_trip_editor(trip_id) and created_by = auth.uid());
create policy "editors update pois" on public.pois for update to authenticated using (public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "editors delete pois" on public.pois for delete to authenticated using (public.is_trip_editor(trip_id));

create policy "members read waypoints" on public.waypoints for select to authenticated using (public.is_trip_member(trip_id));
create policy "editors manage waypoints" on public.waypoints for all to authenticated using (public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));

create policy "members read journal" on public.journal_notes for select to authenticated using (public.is_trip_member(trip_id));
create policy "editors create journal" on public.journal_notes for insert to authenticated with check (public.is_trip_editor(trip_id) and author_id = auth.uid());
create policy "authors or editors update journal" on public.journal_notes for update to authenticated using (author_id = auth.uid() or public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "authors or editors delete journal" on public.journal_notes for delete to authenticated using (author_id = auth.uid() or public.is_trip_editor(trip_id));

create policy "members read photos" on public.photos for select to authenticated using (public.is_trip_member(trip_id));
create policy "editors create photos" on public.photos for insert to authenticated with check (public.is_trip_editor(trip_id) and author_id = auth.uid());
create policy "authors or editors update photos" on public.photos for update to authenticated using (author_id = auth.uid() or public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "authors or editors delete photos" on public.photos for delete to authenticated using (author_id = auth.uid() or public.is_trip_editor(trip_id));

create policy "members read expenses" on public.expenses for select to authenticated using (public.is_trip_member(trip_id));
create policy "editors create expenses" on public.expenses for insert to authenticated with check (public.is_trip_editor(trip_id) and created_by = auth.uid());
create policy "editors manage expenses" on public.expenses for update to authenticated using (public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "editors delete expenses" on public.expenses for delete to authenticated using (public.is_trip_editor(trip_id));
create policy "members read splits" on public.expense_splits for select to authenticated using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_trip_member(e.trip_id)));
create policy "editors manage splits" on public.expense_splits for all to authenticated using (exists (select 1 from public.expenses e where e.id = expense_id and public.is_trip_editor(e.trip_id))) with check (exists (select 1 from public.expenses e where e.id = expense_id and public.is_trip_editor(e.trip_id)));

create policy "members read tracks" on public.gps_tracks for select to authenticated using (public.is_trip_member(trip_id));
create policy "editors create tracks" on public.gps_tracks for insert to authenticated with check (public.is_trip_editor(trip_id) and created_by = auth.uid());
create policy "owners of tracks update" on public.gps_tracks for update to authenticated using (created_by = auth.uid() or public.is_trip_editor(trip_id)) with check (public.is_trip_editor(trip_id));
create policy "owners of tracks delete" on public.gps_tracks for delete to authenticated using (created_by = auth.uid() or public.is_trip_editor(trip_id));
create policy "members read track points" on public.gps_track_points for select to authenticated using (exists (select 1 from public.gps_tracks t where t.id = track_id and public.is_trip_member(t.trip_id)));
create policy "track owners write points" on public.gps_track_points for insert to authenticated with check (exists (select 1 from public.gps_tracks t where t.id = track_id and t.created_by = auth.uid() and public.is_trip_editor(t.trip_id)));
create policy "track owners delete points" on public.gps_track_points for delete to authenticated using (exists (select 1 from public.gps_tracks t where t.id = track_id and (t.created_by = auth.uid() or public.is_trip_editor(t.trip_id))));

create policy "members read live locations" on public.member_locations for select to authenticated using (public.is_trip_member(trip_id));
create policy "users insert own live location" on public.member_locations for insert to authenticated with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy "users update own live location" on public.member_locations for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_trip_member(trip_id));
create policy "users delete own live location" on public.member_locations for delete to authenticated using (user_id = auth.uid() or public.is_trip_owner(trip_id));

-- Stockage des photos : le chemin doit commencer par "<trip_id>/".
insert into storage.buckets (id, name, public) values ('trip-photos', 'trip-photos', false) on conflict (id) do nothing;
create policy "members read trip photos" on storage.objects for select to authenticated using (bucket_id = 'trip-photos' and public.is_trip_member((storage.foldername(name))[1]::uuid));
create policy "editors upload trip photos" on storage.objects for insert to authenticated with check (bucket_id = 'trip-photos' and owner_id = (select auth.uid()::text) and public.is_trip_editor((storage.foldername(name))[1]::uuid));
create policy "owners manage their trip photos" on storage.objects for update to authenticated using (bucket_id = 'trip-photos' and owner_id = (select auth.uid()::text)) with check (bucket_id = 'trip-photos' and owner_id = (select auth.uid()::text));
create policy "owners delete their trip photos" on storage.objects for delete to authenticated using (bucket_id = 'trip-photos' and owner_id = (select auth.uid()::text));

-- Active les mises à jour temps réel utilisées par le radar et la synchro collaborative.
alter publication supabase_realtime add table public.pois, public.waypoints, public.journal_notes, public.photos, public.expenses, public.expense_splits, public.gps_tracks, public.gps_track_points, public.member_locations;

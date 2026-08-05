-- Reset complet (SQL Editor Supabase, rôle postgres).
-- Conserve auth.users + profiles. Vide tous les voyages puis recrée l’équipage.
-- Invite attendue côté app : ACF77E77 (ou celle affichée dans le NOTICE).

truncate table
  public.gps_track_points,
  public.gps_tracks,
  public.expense_splits,
  public.expenses,
  public.photos,
  public.journal_notes,
  public.waypoints,
  public.pois,
  public.member_locations,
  public.trip_members,
  public.trips
restart identity cascade;

-- Nettoie les métadonnées auth trop lourdes (avatars base64 dans le JWT).
update auth.users
set raw_user_meta_data =
  coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'avatar_url',
    case
      when coalesce(raw_user_meta_data->>'avatar_url', '') like 'http%'
        then raw_user_meta_data->>'avatar_url'
      else ''
    end
  );

do $$
declare
  adel_id uuid;
  paul_id uuid;
  yanis_id uuid;
  trip uuid;
  invite text;
begin
  select id into adel_id from auth.users where lower(email) = 'adel@vanlife.local' limit 1;
  select id into paul_id from auth.users where lower(email) = 'paul@vanlife.local' limit 1;
  select id into yanis_id from auth.users where lower(email) = 'yanis@vanlife.local' limit 1;

  if adel_id is null then
    raise exception 'Compte Adel introuvable';
  end if;

  insert into public.trips (id, name, description, owner_id, invite_code)
  values (
    'acf77e77-a32b-4099-9a71-8831d77f9692',
    'Road Trip Van — Équipage',
    'Voyage partagé Adel · Paul · Yanis',
    adel_id,
    'ACF77E77'
  )
  on conflict (id) do update
    set name = excluded.name,
        description = excluded.description,
        owner_id = excluded.owner_id,
        invite_code = excluded.invite_code
  returning id, invite_code into trip, invite;

  insert into public.trip_members (trip_id, user_id, member_role)
  values (trip, adel_id, 'owner')
  on conflict (trip_id, user_id) do update set member_role = 'owner';

  if paul_id is not null then
    insert into public.trip_members (trip_id, user_id, member_role)
    values (trip, paul_id, 'editor')
    on conflict (trip_id, user_id) do update set member_role = 'editor';
  end if;

  if yanis_id is not null then
    insert into public.trip_members (trip_id, user_id, member_role)
    values (trip, yanis_id, 'editor')
    on conflict (trip_id, user_id) do update set member_role = 'editor';
  end if;

  -- Tous les membres équipage = éditeurs (mêmes droits d’écriture).
  update public.trip_members
  set member_role = case when user_id = adel_id then 'owner' else 'editor' end
  where trip_id = trip;

  raise notice 'Trip prêt: % — invite: %', trip, invite;
end $$;

-- Owner = trips.owner_id OU member_role owner (débloque delete / gestion équipage).
create or replace function public.is_trip_owner(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = target_trip and t.owner_id = auth.uid()
  )
  or exists (
    select 1 from public.trip_members tm
    where tm.trip_id = target_trip
      and tm.user_id = auth.uid()
      and tm.member_role = 'owner'
  );
$$;

update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v', 'video/mov'
  ],
  public = true
where id = 'trip-photos';

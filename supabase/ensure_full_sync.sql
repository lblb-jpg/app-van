-- VanLife — ensure schema + realtime + storage + invite RPC are ready for full sync.
-- Safe to re-run on an existing project (idempotent).
-- Run in Supabase SQL Editor after vanlife_on_shared.sql / schema.sql.

-- ── Waypoint photos ──────────────────────────────────────────────
alter table public.waypoints
  add column if not exists photo_urls text[] not null default '{}';

-- ── Invite codes ───────────────────────────────────────────────
alter table public.trips
  add column if not exists invite_code text;

update public.trips
set invite_code = upper(substr(replace(id::text, '-', ''), 1, 8))
where invite_code is null or invite_code = '';

create unique index if not exists trips_invite_code_uidx on public.trips (invite_code);

create or replace function public.ensure_trip_invite_code()
returns trigger language plpgsql as $$
begin
  if new.invite_code is null or new.invite_code = '' then
    new.invite_code := upper(substr(replace(coalesce(new.id, gen_random_uuid())::text, '-', ''), 1, 8));
  end if;
  return new;
end;
$$;

drop trigger if exists set_trip_invite_code on public.trips;
create trigger set_trip_invite_code
  before insert on public.trips
  for each row execute procedure public.ensure_trip_invite_code();

create or replace function public.join_trip_by_code(invite text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
  cleaned text := upper(regexp_replace(trim(coalesce(invite, '')), '[^A-Z0-9]', '', 'g'));
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;

  if cleaned is null or length(cleaned) < 6 then
    raise exception 'Code invitation invalide';
  end if;

  select t.id into target
  from public.trips t
  where upper(coalesce(t.invite_code, '')) = cleaned
     or upper(substr(replace(t.id::text, '-', ''), 1, 8)) = cleaned
  limit 1;

  if target is null then
    raise exception 'Aucun voyage pour ce code';
  end if;

  insert into public.trip_members (trip_id, user_id, member_role)
  values (target, auth.uid(), 'editor')
  on conflict (trip_id, user_id) do nothing;

  return target;
end;
$$;

grant execute on function public.join_trip_by_code(text) to authenticated;
grant execute on function public.join_trip_by_code(text) to anon;

-- ── Storage bucket (public so gallery <img> works reliably) ───
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trip-photos',
  'trip-photos',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public read for trip-photos (bucket is public); keep member policies too.
do $$ begin
  create policy "vanlife public read trip photos"
    on storage.objects for select
    using (bucket_id = 'trip-photos');
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "vanlife members read trip photos"
    on storage.objects for select to authenticated
    using (bucket_id = 'trip-photos' and public.is_trip_member((storage.foldername(name))[1]::uuid));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "vanlife editors upload trip photos"
    on storage.objects for insert to authenticated
    with check (bucket_id = 'trip-photos' and public.is_trip_editor((storage.foldername(name))[1]::uuid));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "vanlife editors update trip photos"
    on storage.objects for update to authenticated
    using (bucket_id = 'trip-photos' and public.is_trip_editor((storage.foldername(name))[1]::uuid))
    with check (bucket_id = 'trip-photos' and public.is_trip_editor((storage.foldername(name))[1]::uuid));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "vanlife editors delete trip photos"
    on storage.objects for delete to authenticated
    using (bucket_id = 'trip-photos' and public.is_trip_editor((storage.foldername(name))[1]::uuid));
exception when duplicate_object then null;
end $$;

-- ── Realtime publication for every synced domain ─────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'pois',
    'waypoints',
    'journal_notes',
    'photos',
    'expenses',
    'expense_splits',
    'gps_tracks',
    'gps_track_points',
    'member_locations',
    'trip_members',
    'trips',
    'profiles'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
      when undefined_table then null;
    end;
  end loop;
end $$;

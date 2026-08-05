-- Positions live + rejoindre un voyage via code (8 premiers caractères de l'id).
-- Safe to re-run.

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

-- Rejoindre un voyage avec le code court (invite_code ou préfixe d'UUID).
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

do $$
begin
  alter publication supabase_realtime add table public.member_locations;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.trip_members;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Donne les droits d'écriture (editor) à tous les membres équipage.
-- Owner du voyage (trips.owner_id) est aussi reconnu comme owner membre.

update public.trip_members tm
set member_role = 'owner'
from public.trips t
where tm.trip_id = t.id
  and tm.user_id = t.owner_id
  and tm.member_role is distinct from 'owner';

update public.trip_members
set member_role = 'editor'
where member_role = 'viewer';

-- Align is_trip_owner sur trips.owner_id (évite les voyages "coincés").
create or replace function public.is_trip_owner(target_trip uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = target_trip
      and t.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.trip_members tm
    where tm.trip_id = target_trip
      and tm.user_id = auth.uid()
      and tm.member_role = 'owner'
  );
$$;

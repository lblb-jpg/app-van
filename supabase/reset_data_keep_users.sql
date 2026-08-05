-- Reset all vanlife trip data while keeping auth.users + profiles.
-- Run in Supabase → SQL Editor (service role / dashboard). Storage objects
-- are not deleted by CASCADE — empty the `trip-photos` bucket separately.

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

-- Do NOT truncate/delete:
--   public.profiles
--   auth.users

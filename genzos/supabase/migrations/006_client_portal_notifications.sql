-- GENZ FILMS OS - Migration 006: tell client-portal users when something is waiting for their approval.
-- Everything else the portal needs (client RLS on videos/scripts/comments/approvals/calendar, decide(), portal_client) already exists in 005.
create or replace function notify_client_review() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; is_video boolean := (tg_table_name = 'videos'); st text; t text;
begin
  st := case when is_video then new.stage else new.status end;
  if st = 'client_review' and (tg_op = 'INSERT' or (case when is_video then old.stage else old.status end) is distinct from 'client_review') then
    t := case when is_video then 'Video ready for your review: ' else 'Script ready for your review: ' end || new.title;
    for r in select id from profiles where role = 'client' and is_active and client_id = new.client_id loop
      perform notify(r.id, t, null, '/portal', 'review:' || tg_table_name || ':' || new.id || ':' || r.id || ':' || extract(epoch from now())::bigint);
    end loop;
  end if;
  return null;
end $$;
create trigger trg_videos_client_notify after insert or update on videos for each row execute function notify_client_review();
create trigger trg_scripts_client_notify after insert or update on scripts for each row execute function notify_client_review();

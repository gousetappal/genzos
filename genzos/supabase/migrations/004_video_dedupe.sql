-- GENZ FILMS OS - Migration 004: stop the same published link being counted twice for a client.
-- If this fails with "could not create unique index", you already have duplicate links:
-- remove the extra rows in Clients > (client) > Deliverables, then run it again.
create unique index if not exists videos_unique_link
  on videos (client_id, lower(published_url))
  where status = 'published';

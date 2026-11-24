# GENZ FILMS OS
## Setup
1. Create a Supabase project. In the SQL editor run, in order:
   001_phase1_core_and_security.sql, 002_research_and_strategy.sql, 003_videos_deliverables.sql, 004_video_dedupe.sql, 005_production_pipeline.sql, **006_client_portal_notifications.sql**
2. Auth > Users > add your account, then in SQL: update profiles set role = 'admin' where email = 'you@example.com';
3. cp .env.example .env.local and fill in the project URL + anon key (Settings > API). Never put the service-role key in frontend code.
4. npm install && npm run dev  ->  http://localhost:3000
5. Deploy: import the repo in Vercel and add the same two env vars.

## Admin workflow
- Clients > "Add a client": business name, videos wanted / month, contract months, package amount, competitors (one per line).
- Client > Deliverables: paste the published link + title + date > "Add published video". Counts update instantly
  (this month, remaining, all-time vs contract total). The same link can't be counted twice for one client.
- Clients list shows "Published this month x / target" and competitor count; Dashboard shows the agency-wide total.
- Delete: red "Delete" on each client row (admin only, needs the tick-box). Deletes all research, competitors and video records.

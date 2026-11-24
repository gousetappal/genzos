#!/bin/bash
# Rebuilds database "g" from scratch: stub auth schema + every migration in order.
# Needs a local Postgres 16 on socket dir /tmp, port 5544 (see README "Testing the database").
D="$(cd "$(dirname "$0")" && pwd)"
B=/usr/lib/postgresql/16/bin; P="$B/psql -h /tmp -p 5544 -U postgres -v ON_ERROR_STOP=1 -q"
$P -d postgres -c 'drop database if exists g' -c 'create database g' || exit 1
for f in "$D/stub_auth.sql" "$D"/../migrations/*.sql; do
  echo "== $(basename "$f")"; $P -d g -f "$f" 2>&1 | head -8; [ "${PIPESTATUS[0]}" = 0 ] || { echo "FAILED: $f"; exit 1; }
done
$P -d g -c "grant select,insert,update,delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated; grant execute on all functions in schema public to authenticated;"

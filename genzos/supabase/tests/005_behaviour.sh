B=/usr/lib/postgresql/16/bin
q(){ $B/psql -h /tmp -p 5544 -U postgres -d g -tA -q -c "$1" 2>&1 | head -3; }
# $1 uid, $2 sql
as(){ $B/psql -h /tmp -p 5544 -U postgres -d g -tA -q -c "set role authenticated; select set_config('request.jwt.claim.sub','$1',false); $2" 2>&1 | grep -v '^[0-9a-f-]\{36\}$' | head -3; }
A=00000000-0000-0000-0000-00000000000a; PM=00000000-0000-0000-0000-0000000000b0; E1=00000000-0000-0000-0000-0000000000e1; E2=00000000-0000-0000-0000-0000000000e2; C=00000000-0000-0000-0000-0000000000c1; C2=00000000-0000-0000-0000-0000000000c2
CL1=11111111-1111-1111-1111-111111111111; CL2=22222222-2222-2222-2222-222222222222
q "truncate auth.users cascade; truncate clients cascade;"
for p in "$A admin a" "$PM pm b" "$E1 emp e1" "$E2 emp e2" "$C cl c1" "$C2 cl c2"; do set -- $p; q "insert into auth.users(id,email) values('$1','$3@x.com')"; done
q "set session_replication_role=replica; update profiles set role='admin' where id='$A'; update profiles set role='project_manager' where id='$PM'; update profiles set role='client', client_id='$CL1' where id='$C'; update profiles set role='client', client_id='$CL2' where id='$C2';"
q "insert into clients(id,business_name,project_manager_id) values('$CL1','Alpha','$PM'),('$CL2','Beta','$PM'); insert into client_assignments values('$CL1','$E1');"
q "insert into client_finance(client_id,monthly_package_amount) values('$CL1',5000)"
echo "--employee reads finance (expect 0 rows/denied):"; as $E1 "select count(*) from client_finance;"
echo "--client reads clients table directly (expect 0):"; as $C "select count(*) from clients;"
echo "--client portal_client (expect 1 Alpha):"; as $C "select business_name from portal_client;"
q "insert into scripts(id,client_id,title,hook) values('aaaaaaaa-0000-0000-0000-000000000001','$CL1','S1','h1')"
S=aaaaaaaa-0000-0000-0000-000000000001
echo "--employee approves script via decide (expect error):"; as $E1 "select decide('script','$S','approved')"
echo "--employee direct status=approved (expect error):"; as $E1 "update scripts set status='approved' where id='$S'"
echo "--employee edit -> version 2:"; as $E1 "update scripts set hook='h2' where id='$S'"; q "select version, (select count(*) from script_versions) from scripts"
echo "--pm approves, send to client:"; as $PM "select decide('script','$S','approved')"; as $PM "select decide('script','$S','send_to_client')"; q "select status from scripts"
echo "--client2 sees script? (expect 0):"; as $C2 "select count(*) from scripts"
echo "--client1 sees script (1):"; as $C "select count(*) from scripts"
echo "--client1 decide approve:"; as $C "select decide('script','$S','approved')"; q "select status from scripts"
echo "--client2 decide on it (expect error):"; as $C2 "select decide('script','$S','approved')"
echo "--client direct update (expect 0 rows/denied):"; as $C "update scripts set status='draft' where id='$S'"
echo "--edit after approval resets (draft):"; as $E1 "update scripts set hook='h3' where id='$S'"; q "select status,version from scripts"
echo "--client direct approvals insert (expect denied):"; as $C "insert into approvals(client_id,entity_type,entity_id,decision) values('$CL1','script','$S','approved')"
# video
q "insert into videos(id,client_id,title,status) values('bbbbbbbb-0000-0000-0000-000000000001','$CL1','V1','planned')"
V=bbbbbbbb-0000-0000-0000-000000000001
echo "--employee sets video approved (expect error):"; as $E1 "update videos set stage='approved' where id='$V'"
echo "--employee publish unapproved (expect error):"; as $E1 "update videos set stage='published', published_url='http://x', published_on=current_date where id='$V'"
echo "--employee sets internal_review ok:"; as $E1 "update videos set stage='internal_review' where id='$V'"; q "select stage from videos"
echo "--notif to managers:"; q "select count(*) from notifications where title like 'Video awaiting%'"
as $PM "select decide('video','$V','send_to_client')"; as $C "select decide('video','$V','approved')"; q "select stage,status,client_approved_at is not null from videos"
echo "--employee publish approved without url (expect error):"; as $E1 "update videos set stage='published' where id='$V'"
echo "--employee publish with url:"; as $E1 "update videos set stage='published', published_url='http://x' where id='$V'"; q "select stage,status,published_on from videos"
echo "--employee cannot delete video:"; as $E1 "delete from videos where id='$V' returning 1"
# shoots
echo "--employee creates shoot (expect denied):"; as $E1 "insert into shoots(client_id,title,starts_at,ends_at,camera_operator_id) values('$CL1','x',now(),now()+interval '2h','$E1')"
as $PM "insert into shoots(id,client_id,title,starts_at,ends_at,camera_operator_id) values('cccccccc-0000-0000-0000-000000000001','$CL1','Sh1','2030-01-01 10:00+00','2030-01-01 12:00+00','$E1')"
echo "--overlap same operator (expect conflict):"; as $PM "insert into shoots(client_id,title,starts_at,ends_at,camera_operator_id) values('$CL2','Sh2','2030-01-01 11:00+00','2030-01-01 13:00+00','$E1')"
echo "--back-to-back ok:"; as $PM "insert into shoots(client_id,title,starts_at,ends_at,camera_operator_id) values('$CL2','Sh3','2030-01-01 12:00+00','2030-01-01 13:00+00','$E1')"; q "select count(*) from shoots"
echo "--equipment double-book:"; q "insert into equipment(id,name) values('eeeeeeee-0000-0000-0000-000000000001','Cam')"
as $PM "insert into shoot_equipment values('cccccccc-0000-0000-0000-000000000001','eeeeeeee-0000-0000-0000-000000000001')"
SH3=$(q "select id from shoots where title='Sh3'" | tail -1); as $PM "insert into shoot_equipment values('$SH3','eeeeeeee-0000-0000-0000-000000000001')"; as $PM "update shoots set starts_at='2030-01-01 11:30+00', ends_at='2030-01-01 13:00+00' where id='$SH3'"
echo "--cancel frees:"; as $PM "update shoots set status='cancelled' where id='cccccccc-0000-0000-0000-000000000001'"; as $PM "update shoots set starts_at='2030-01-01 11:30+00' where id='$SH3'"; q "select count(*) from shoot_resources"
echo "--employee sees other client's shoot? (E1 assigned CL1 only; expect 0 for Sh3 CL2):"; as $E1 "select count(*) from shoots where client_id='$CL2'"
echo "--e2 availability for other:"; as $E2 "insert into shoot_availability values('cccccccc-0000-0000-0000-000000000001','$E1','available')"
echo "--employee editing approve (expect error):"; q "insert into videos(id,client_id,title,status) values('bbbbbbbb-0000-0000-0000-000000000002','$CL1','V2','planned')"
as $PM "insert into editing_assignments(video_id,client_id,editor_id) values('bbbbbbbb-0000-0000-0000-000000000002','$CL1','$E1')"
as $E1 "update editing_assignments set status='delivered'"; as $E1 "update editing_assignments set status='review'"; q "select stage from videos where title='V2'"

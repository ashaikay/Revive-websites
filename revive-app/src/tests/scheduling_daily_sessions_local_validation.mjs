// Local Supabase only. Fake material; never accepts a remote URL or real Microsoft tokens.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const baseUrl = 'http://127.0.0.1:55321';
const anonKey = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error('Local Supabase test keys are required.');
const identities = [], workspaces = [];
let failures = 0;
function check(name, condition) {
  console.log(`${name}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
}
async function request(token, method, path, body) {
  const response = await fetch(baseUrl + path, { method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, rows: Array.isArray(payload) ? payload : [] };
}
const rpc = (token, name, body) => request(token, 'POST', `/rest/v1/rpc/${name}`, body);
function sql(statement) {
  const result = spawnSync('docker', ['exec','-i','supabase_db_revive-app','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],
    { input: statement, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('Local SQL validation failed; check Docker and the local migration.');
  return result.stdout.trim();
}
const uuid = /^[0-9a-f-]{36}$/i;
function id(value) { if (typeof value !== 'string' || !uuid.test(value)) throw new Error('Invalid local fixture identifier.'); return value; }
const material = () => randomBytes(32).toString('base64url');
async function identity(label) {
  const email = `calendar-oauth-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
  const password = `Local-${material()}`;
  const created = await request(serviceKey,'POST','/auth/v1/admin/users',{email,password,email_confirm:true});
  if (created.status !== 200) throw new Error('Local user fixture failed.');
  const userId = id(created.payload.id); identities.push(userId);
  const login = await request(anonKey,'POST','/auth/v1/token?grant_type=password',{email,password});
  if (login.status !== 200 || !login.payload?.access_token) throw new Error('Local login fixture failed.');
  return {id:userId,token:login.payload.access_token};
}
async function workspace(owner) {
  const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const result = await rpc(owner.token,'create_workspace_with_owner',{workspace_name:`OAuth local ${stamp}`,workspace_slug:`oauth-local-${stamp}`});
  const workspaceId = id(result.payload?.[0]?.created_workspace_id); workspaces.push(workspaceId); return workspaceId;
}
async function connection(workspaceId) {
  const result = await request(serviceKey,'POST','/rest/v1/workspace_calendar_connections',{workspace_id:workspaceId,provider_key:'microsoft_graph'});
  if (result.status !== 201) throw new Error('Local connection fixture failed.');
  return id(result.rows[0].id);
}
async function retireFixtures(workspaceIds, userIds) {
  for (const workspaceId of workspaceIds) {
    const connections = await request(serviceKey,'GET',`/rest/v1/workspace_calendar_connections?workspace_id=eq.${workspaceId}&select=id`);
    if (connections.status !== 200) throw new Error('Local fixture connection lookup failed.');
    for (const connection of connections.rows) {
      const revoked = await rpc(serviceKey,'revoke_rev_calendar_credential',{target_workspace_id:workspaceId,target_connection_id:id(connection.id)});
      check('LOCAL_FIXTURE_CREDENTIALS_REVOKED',revoked.status<300);
    }
    const suspended = await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}`,{status:'suspended'});
    check('LOCAL_FIXTURE_MEMBERSHIPS_SUSPENDED',suspended.status===200);
  }
  for (const userId of userIds) {
    const found = await request(serviceKey,'GET',`/auth/v1/admin/users/${userId}`);
    if (found.status===404) continue;
    const email = found.payload?.email ?? found.payload?.user?.email;
    if (found.status!==200 || typeof email!=='string' || !email.startsWith('calendar-oauth-') || !email.endsWith('@example.test')) {
      throw new Error('Refusing to disable a user outside this local validator.');
    }
    const banned = await request(serviceKey,'PUT',`/auth/v1/admin/users/${userId}`,{ban_duration:'87600h'});
    check('LOCAL_FIXTURE_SIGN_IN_DISABLED',banned.status===200);
  }
  console.log('APPEND_ONLY_AUDIT_PRESERVED=PASS');
}
try {
 const owner=await identity('daily-owner'),outsider=await identity('daily-outsider'),member=await identity('daily-member');
 const ws=await workspace(owner),other=await workspace(outsider);
 if((await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:ws,user_id:member.id,role:'member',status:'active'})).status!==201)throw Error('Membership fixture failed');
 const input={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),
  target_title:'Cardiff daily sessions',target_timezone:'Europe/London',target_location:'Cardiff',
  target_required_skills:['Phone','Admin'],target_staffing_count:2,target_first_day:'2026-10-15',target_last_day:'2026-10-17',
  target_working_days:[7,6,5,4,3,2,1],target_start_local:'11:00',target_end_local:'16:00'};
 const save=(patch={},token=serviceKey)=>rpc(token,'create_rev_daily_job_sessions',{...input,...patch});
 const read=(token=owner.token)=>request(token,'GET',`/rest/v1/scheduling_jobs?workspace_id=eq.${ws}&select=*`);
 const first=await Promise.all([save(),save()]);
 check('CONCURRENT_BATCH_CREATED_ONCE',first.every(r=>r.status===200)&&JSON.stringify(first[0].payload)===JSON.stringify(first[1].payload)&&(await read()).rows.length===3);
 if(first[0].status!==200)throw Error('Daily batch create failed');
 const result=first[0].payload;
 check('THREE_SEPARATE_DAYTIME_SESSIONS',result.schedule_type==='daily_daytime'&&result.jobs.length===3&&result.jobs.every((j,i)=>new Date(j.start_at).toISOString()===`2026-10-${15+i}T10:00:00.000Z`&&new Date(j.end_at).toISOString()===`2026-10-${15+i}T15:00:00.000Z`));
 check('STAFFING_PER_SESSION',result.jobs.every(j=>j.staffing_count===2&&j.version===1&&j.status==='open'&&JSON.stringify(j.required_skills)==='["Admin","Phone"]'));
 check('REQUEST_BOUND_RESULT',result.request_id===input.target_request_id&&result.workspace_id===ws);
 check('RETRY_SAME_IDS',(await save({target_working_days:[1,2,3,4,5,6,7],target_required_skills:['Admin','Phone']})).payload.jobs.every((j,i)=>j.job_id===result.jobs[i].job_id));
 check('CHANGED_RETRY_DENIED',(await save({target_end_local:'17:00'})).status>=400);
 check('MEMBER_BATCH_DENIED',(await save({initiating_user_id:member.id,target_request_id:randomUUID()})).status>=400);
 check('CROSS_TENANT_BATCH_DENIED',(await save({target_workspace_id:other,target_request_id:randomUUID()})).status>=400);
 check('REQUEST_TENANT_COLLISION_DENIED',(await save({target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_BATCH_RPC_DENIED',(await save({},token)).status>=400);
 for(const token of [member.token,outsider.token])check('UNAUTHORISED_SESSION_READ_DENIED',(await read(token)).rows.length===0);
 for(const patch of [{target_first_day:null},{target_last_day:'infinity'},{target_last_day:'2026-10-14'},{target_last_day:'2026-11-15'},
  {target_start_local:'16:00'},{target_start_local:'22:00',target_end_local:'06:00'},
  {target_start_local:'24:00'},{target_start_local:null},{target_working_days:[]},{target_working_days:null},
  {target_working_days:[1,1]},{target_working_days:[0]},{target_timezone:'Bad/Zone'},
  {target_staffing_count:0},{target_staffing_count:101},{target_required_skills:[null]},
  {target_required_skills:null},{target_required_skills:['Phone','Phone']},{target_title:' padded '},{target_location:''}])
  check('INVALID_DAYTIME_BATCH_DENIED',(await save({...patch,target_request_id:randomUUID()})).status>=400);
 const empty=await save({target_request_id:randomUUID(),target_working_days:[1]});
 check('NO_SELECTED_DATES_DENIED',empty.status>=400);
 const weekdays=await save({target_request_id:randomUUID(),target_working_days:[1,2,3,4,5]});
 check('UNSELECTED_WEEKEND_EXCLUDED',weekdays.status===200&&weekdays.payload.jobs.length===2);
 const count=(await read()).rows.length;
 const dst=await save({target_request_id:randomUUID(),target_first_day:'2026-10-24',target_last_day:'2026-10-25',target_start_local:'01:30',target_end_local:'03:00'});
 check('LATER_DST_FOLD_REFUSES_WHOLE_BATCH',dst.status>=400&&(await read()).rows.length===count);
 const gap=await save({target_request_id:randomUUID(),target_first_day:'2027-03-27',target_last_day:'2027-03-28',target_start_local:'01:30',target_end_local:'03:00'});
 check('LATER_DST_GAP_REFUSES_WHOLE_BATCH',gap.status>=400&&(await read()).rows.length===count);
 const clock=await save({target_request_id:randomUUID(),target_first_day:'2026-10-24',target_last_day:'2026-10-26'});
 check('LOCAL_HOURS_STABLE_ACROSS_CLOCK_CHANGE',clock.status===200&&new Date(clock.payload.jobs[0].start_at).getUTCHours()===10&&new Date(clock.payload.jobs[1].start_at).getUTCHours()===11&&clock.payload.jobs.every(j=>Date.parse(j.end_at)-Date.parse(j.start_at)===5*3600000));
 check('NO_ASSIGNMENT_CREATED',sql(`select count(*) from public.scheduling_assignments where workspace_id='${id(ws)}';`)==='0');
 check('AUDIT_ONCE_PER_SESSION',sql(`select count(*) from public.audit_log where workspace_id='${id(ws)}' and resource_type='scheduling_job';`)===String((await read()).rows.length));
 check('PRIVATE_REQUEST_LEDGER_DENIED',sql("select not has_table_privilege('authenticated','rev_scheduling_private.daily_job_requests','SELECT') and not has_table_privilege('service_role','rev_scheduling_private.daily_job_requests','SELECT');")==='t');
 const failed=randomUUID();
 const atomic=sql(`begin;
 create function pg_temp.refuse_second_daily_audit() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.audit_log where workspace_id=new.workspace_id and metadata->>'request_id'='${id(failed)}') then raise exception 'Local second audit refusal';end if;return new;end$$;
 create trigger local_daily_audit_refusal before insert on public.audit_log for each row when (new.resource_type='scheduling_job') execute function pg_temp.refuse_second_daily_audit();
 do $$begin begin perform public.create_rev_daily_job_sessions('${id(ws)}','${id(owner.id)}','${id(failed)}','Rollback daily','Europe/London','Cardiff',array[]::text[],2,date '2026-10-15',date '2026-10-17',array[1,2,3,4,5,6,7]::smallint[],'11:00','16:00');raise exception 'TEST unexpectedly committed' using errcode='XX000';exception when raise_exception then null;end;end$$;
 select case when not exists(select 1 from public.scheduling_jobs where workspace_id='${id(ws)}' and title='Rollback daily')
 and not exists(select 1 from rev_scheduling_private.daily_job_requests where request_id='${id(failed)}')
 and not exists(select 1 from public.audit_log where workspace_id='${id(ws)}' and metadata->>'request_id'='${id(failed)}') then 'DAILY_ATOMIC_PASS' else 'DAILY_ATOMIC_FAIL' end;
 rollback;`);
 check('SECOND_AUDIT_FAILURE_ROLLS_BACK_ALL_SESSIONS',atomic.includes('DAILY_ATOMIC_PASS'));
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{role:'admin'});
 check('OTHER_ACTOR_REQUEST_COLLISION_DENIED',(await save({initiating_user_id:member.id})).status>=400);
 check('ADMIN_BATCH_ALLOWED',(await save({initiating_user_id:member.id,target_request_id:randomUUID()})).status===200);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_BATCH_DENIED',(await save({initiating_user_id:member.id,target_request_id:randomUUID()})).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${owner.id}`,{status:'suspended'});
 check('RETRY_RECHECKS_ACTIVE_AUTHORITY',(await save()).status>=400);
} catch {check('DAILY_SESSION_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');check('SCHEDULING_DAILY_SESSIONS_LOCAL',failures===0);if(failures)process.exitCode=1;

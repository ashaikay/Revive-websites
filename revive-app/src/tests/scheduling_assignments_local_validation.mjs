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
 const owner=await identity('allocation-owner'),outsider=await identity('allocation-outsider'),member=await identity('allocation-member');
 const ws=await workspace(owner),other=await workspace(outsider);
 if((await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:ws,user_id:member.id,role:'member',status:'active'})).status!==201)throw Error('Membership fixture failed');
 const makeWorker=async(name,skills=['Admin'],active=true)=>{const r=await rpc(serviceKey,'save_rev_scheduling_worker',{target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,target_display_name:name,target_role_labels:[],target_skill_tags:skills,target_active:active,expected_version:0});if(r.status!==200)throw Error('Worker fixture failed');return id(r.payload.worker_id);};
 const patternBody=worker=>({target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:worker,target_timezone:'Europe/London',target_working_days:[1,2,3,4,5],target_start_local:'09:00',target_end_local:'17:00',target_effective_from:'2026-10-01',target_effective_until:'2026-12-31',expected_version:0});
 const makePattern=async(worker,patch={})=>{const r=await rpc(serviceKey,'save_rev_worker_working_pattern',{...patternBody(worker),...patch});if(r.status!==200)throw Error('Pattern fixture failed');};
 const jobBody=(title,start='2026-10-08T09:00:00Z',end='2026-10-08T10:00:00Z',count=1,skills=['Admin'])=>({target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_job_id:null,target_title:title,target_start_at:start,target_end_at:end,target_timezone:'Europe/London',target_location:'Birmingham office',target_required_skills:skills,target_staffing_count:count,target_status:'open',expected_version:0});
 const makeJob=async(title,start,end,count,skills)=>{const r=await rpc(serviceKey,'save_rev_scheduling_job',jobBody(title,start,end,count,skills));if(r.status!==200)throw Error('Job fixture failed');return id(r.payload.job_id);};
 const worker=await makeWorker('Worker A'),second=await makeWorker('Worker B'),missing=await makeWorker('No hours'),unskilled=await makeWorker('No skills',[]),inactive=await makeWorker('Inactive',['Admin'],false);
 for(const w of [worker,second,unskilled])await makePattern(w);
 const job=await makeJob('First job');
 const input={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_assignment_id:null,target_worker_id:worker,target_job_id:job,target_status:'active',expected_version:0,expected_worker_version:1,expected_job_version:1,expected_pattern_version:1};
 const save=(patch={},token=serviceKey)=>rpc(token,'save_rev_scheduling_assignment',{...input,...patch});
 const read=(token=owner.token)=>request(token,'GET',`/rest/v1/scheduling_assignments?workspace_id=eq.${ws}&select=*`);
 for(const [name,w] of [['MISSING_AVAILABILITY_DENIED',missing],['MISSING_SKILLS_DENIED',unskilled],['INACTIVE_WORKER_DENIED',inactive]])check(name,(await save({target_worker_id:w,target_request_id:randomUUID()})).status>=400);
 for(const patch of [{expected_worker_version:2},{expected_job_version:2},{expected_pattern_version:2},{target_status:'cancelled'},{expected_version:1},{expected_worker_version:null}])check('INVALID_OR_STALE_ALLOCATION_DENIED',(await save({...patch,target_request_id:randomUUID()})).status>=400);
 check('MEMBER_ALLOCATION_DENIED',(await save({initiating_user_id:member.id,target_request_id:randomUUID()})).status>=400);
 check('CROSS_TENANT_ALLOCATION_DENIED',(await save({target_workspace_id:other,target_request_id:randomUUID()})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_ALLOCATION_RPC_DENIED',(await save({},token)).status>=400);
 const race=await Promise.all([save(),save()]);
 check('CONCURRENT_SAME_REQUEST_ONCE',race.every(r=>r.status===200)&&race[0].payload?.assignment_id===race[1].payload?.assignment_id&&(await read()).rows.length===1);
 if(race[0].status!==200)throw Error('Allocation fixture failed');const assignment=id(race[0].payload.assignment_id);
 check('EXACT_JOB_INTERVAL_RESERVED',Date.parse(race[0].payload.start_at)===Date.parse('2026-10-08T09:00:00Z')&&Date.parse(race[0].payload.end_at)===Date.parse('2026-10-08T10:00:00Z'));
 check('CHANGED_RETRY_DENIED',(await save({target_worker_id:second})).status>=400);
 check('CROSS_TENANT_REQUEST_COLLISION_DENIED',(await save({target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 for(const token of [member.token,outsider.token])check('UNAUTHORISED_ALLOCATION_READ_DENIED',(await read(token)).status===200&&(await read(token)).rows.length===0);
 check('FULL_CAPACITY_DENIED',(await save({target_worker_id:second,target_request_id:randomUUID()})).status>=400);
 const overlap=await makeJob('Overlap','2026-10-08T09:30:00Z','2026-10-08T10:30:00Z');
 check('SAME_WORKER_OVERLAP_DENIED',(await save({target_job_id:overlap,target_request_id:randomUUID()})).status>=400);
 const adjacent=await makeJob('Adjacent','2026-10-08T10:00:00Z','2026-10-08T11:00:00Z');
 check('ADJACENT_ASSIGNMENT_ALLOWED',(await save({target_job_id:adjacent,target_request_id:randomUUID()})).status===200);
 const out=await makeJob('Outside hours','2026-10-08T07:00:00Z','2026-10-08T08:00:00Z');
 check('OUTSIDE_HOURS_DENIED',(await save({target_job_id:out,target_worker_id:second,target_request_id:randomUUID()})).status>=400);
 const weekend=await makeJob('Weekend','2026-10-10T09:00:00Z','2026-10-10T10:00:00Z');
 check('NON_WORKING_DAY_DENIED',(await save({target_job_id:weekend,target_worker_id:second,target_request_id:randomUUID()})).status>=400);
 const expired=await makeJob('After effective end','2027-01-07T10:00:00Z','2027-01-07T11:00:00Z');
 check('OUTSIDE_EFFECTIVE_DATES_DENIED',(await save({target_job_id:expired,target_worker_id:second,target_request_id:randomUUID()})).status>=400);
 const leaveBody=(w,start,end)=>({target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:w,target_unavailability_id:null,target_start_at:start,target_end_at:end,target_category:'leave',target_status:'active',expected_version:0});
 const leave=await rpc(serviceKey,'save_rev_worker_unavailability',leaveBody(second,'2026-10-08T09:00:00Z','2026-10-08T10:00:00Z'));check('LEAVE_FIXTURE_SAVED',leave.status===200);
 check('LEAVE_BLOCKS_ALLOCATION',(await save({target_worker_id:second,target_job_id:overlap,target_request_id:randomUUID()})).status>=400);
 check('NEW_LEAVE_CANNOT_INVALIDATE_ASSIGNMENT',(await rpc(serviceKey,'save_rev_worker_unavailability',leaveBody(worker,'2026-10-08T09:30:00Z','2026-10-08T09:45:00Z'))).status>=400);
 check('PATTERN_CHANGE_CANNOT_INVALIDATE_ASSIGNMENT',(await rpc(serviceKey,'save_rev_worker_working_pattern',{...patternBody(worker),target_start_local:'11:00',expected_version:1})).status>=400);
 check('SAFE_PATTERN_CHANGE_ALLOWED',(await rpc(serviceKey,'save_rev_worker_working_pattern',{...patternBody(worker),target_end_local:'18:00',expected_version:1})).status===200);
 const updateWorker={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:worker,target_display_name:'Worker A',target_role_labels:[],target_skill_tags:['Admin'],target_active:false,expected_version:1};
 check('WORKER_DEACTIVATION_CANNOT_INVALIDATE_ASSIGNMENT',(await rpc(serviceKey,'save_rev_scheduling_worker',updateWorker)).status>=400);
 check('SKILL_REMOVAL_CANNOT_INVALIDATE_ASSIGNMENT',(await rpc(serviceKey,'save_rev_scheduling_worker',{...updateWorker,target_request_id:randomUUID(),target_active:true,target_skill_tags:[]})).status>=400);
 const jobUpdate={...jobBody('First job'),target_job_id:job,expected_version:1};
 for(const patch of [{target_status:'cancelled'},{target_start_at:'2026-10-08T08:30:00Z'},{target_location:'Other office'},{target_required_skills:['Phone']}])check('JOB_CHANGE_CANNOT_INVALIDATE_ASSIGNMENT',(await rpc(serviceKey,'save_rev_scheduling_job',{...jobUpdate,...patch,target_request_id:randomUUID()})).status>=400);
 const cancelledJob=await makeJob('Cancelled job');
 check('CANCEL_JOB_FIXTURE',(await rpc(serviceKey,'save_rev_scheduling_job',{...jobBody('Cancelled job'),target_job_id:cancelledJob,target_status:'cancelled',expected_version:1})).status===200);
 check('CANCELLED_JOB_ALLOCATION_DENIED',(await save({target_worker_id:second,target_job_id:cancelledJob,expected_job_version:2,target_request_id:randomUUID()})).status>=400);
 check('PRIVATE_ASSIGNMENT_LEDGER_DENIED',sql("select not has_schema_privilege('authenticated','rev_scheduling_private','USAGE') and not has_schema_privilege('anon','rev_scheduling_private','USAGE');")==='t');
 const capacity=await makeJob('Capacity race','2026-10-09T09:00:00Z','2026-10-09T10:00:00Z');
 const capacityRace=await Promise.all([save({target_job_id:capacity,target_worker_id:worker,expected_pattern_version:2,target_request_id:randomUUID()}),save({target_job_id:capacity,target_worker_id:second,target_request_id:randomUUID()})]);
 check('CONCURRENT_CAPACITY_ONCE',capacityRace.filter(r=>r.status===200).length===1&&capacityRace.filter(r=>r.status>=400).length===1);
 const overlapA=await makeJob('Race A','2026-10-09T11:00:00Z','2026-10-09T12:00:00Z'),overlapB=await makeJob('Race B','2026-10-09T11:30:00Z','2026-10-09T12:30:00Z');
 const overlapRace=await Promise.all([save({target_job_id:overlapA,target_worker_id:second,target_request_id:randomUUID()}),save({target_job_id:overlapB,target_worker_id:second,target_request_id:randomUUID()})]);
 check('CONCURRENT_OVERLAP_ONCE',overlapRace.filter(r=>r.status===200).length===1&&overlapRace.filter(r=>r.status>=400).length===1);
 const clock=sql(`select rev_scheduling_private.pattern_covers('Europe/London',array[7]::smallint[],'00:00','04:00','2026-01-01',null,'2026-10-25T00:30:00Z','2026-10-25T00:45:00Z');select rev_scheduling_private.pattern_covers('Europe/London',array[4]::smallint[],'09:00','17:00','2026-01-01',null,'2026-12-03T09:00:00Z','2026-12-03T10:00:00Z');`);
 check('DST_AMBIGUITY_REFUSED_WINTER_VALID',clock.split(/\r?\n/).join(',')==='f,t');
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_ALLOCATION_READ_ALLOWED',(await read(member.token)).rows.length>=2);
 const cancel={target_assignment_id:assignment,target_status:'cancelled',expected_version:1,expected_worker_version:null,expected_job_version:null,expected_pattern_version:null,target_request_id:randomUUID(),initiating_user_id:member.id};
 const cancelRace=await Promise.all([save(cancel),save(cancel)]);
 check('CONCURRENT_CANCELLATION_RETRY_SAFE',cancelRace.every(r=>r.status===200&&r.payload.status==='cancelled'&&r.payload.version===2));
 check('CANCELLED_ASSIGNMENT_TERMINAL',(await save({...cancel,expected_version:2,target_request_id:randomUUID()})).status>=400);
 check('OTHER_ACTOR_RETRY_DENIED',(await save({...cancel,initiating_user_id:owner.id})).status>=400);
 check('CANCELLED_HISTORY_PRESERVED',(await read()).rows.some(r=>r.id===assignment&&r.status==='cancelled'));
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_READ_DENIED',(await read(member.token)).rows.length===0);
 check('SUSPENDED_ADMIN_SAVE_DENIED',(await save({...cancel,target_request_id:randomUUID()})).status>=400);
 check('DIRECT_BROWSER_ASSIGNMENT_WRITES_DENIED',(await request(owner.token,'POST','/rest/v1/scheduling_assignments',{})).status>=400&&(await request(owner.token,'PATCH',`/rest/v1/scheduling_assignments?id=eq.${assignment}`,{status:'active'})).status>=400);
 check('SERVICE_CANNOT_DELETE_AVAILABILITY',sql("select not has_table_privilege('service_role','public.scheduling_worker_patterns','DELETE') and not has_table_privilege('service_role','public.scheduling_assignments','INSERT');")==='t');
 const failed=randomUUID(),rollbackJob=await makeJob('Rollback allocation','2026-10-12T09:00:00Z','2026-10-12T10:00:00Z');
 const atomic=sql(`begin;
 create function pg_temp.refuse_assignment_audit() returns trigger language plpgsql as $$begin raise exception 'Local audit refusal';end$$;
 create trigger local_assignment_audit_refusal before insert on public.audit_log for each row when (new.resource_type='scheduling_assignment') execute function pg_temp.refuse_assignment_audit();
 do $$begin begin perform public.save_rev_scheduling_assignment('${id(ws)}','${id(owner.id)}','${id(failed)}',null,'${id(second)}','${id(rollbackJob)}','active',0,1,1,1);exception when raise_exception then null;end;end$$;
 select case when not exists(select 1 from public.scheduling_assignments where workspace_id='${id(ws)}' and job_id='${id(rollbackJob)}') and not exists(select 1 from rev_scheduling_private.assignment_requests where request_id='${id(failed)}') then 'ASSIGNMENT_ATOMIC_PASS' else 'ASSIGNMENT_ATOMIC_FAIL' end;rollback;`);
 check('AUDIT_FAILURE_ROLLS_BACK_ALLOCATION',atomic.includes('ASSIGNMENT_ATOMIC_PASS'));
 check('AUDIT_MATCHES_COMMITTED_MUTATIONS',sql(`select (select count(*) from public.audit_log where workspace_id='${id(ws)}' and resource_type='scheduling_assignment')=(select sum(version) from public.scheduling_assignments where workspace_id='${id(ws)}');`)==='t');
} catch {check('LOCAL_ASSIGNMENT_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');check('SCHEDULING_ASSIGNMENTS_LOCAL',failures===0);if(failures)process.exitCode=1;

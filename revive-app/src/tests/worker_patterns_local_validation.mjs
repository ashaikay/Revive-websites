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
 const owner=await identity('pattern-owner'),outsider=await identity('pattern-outsider'),member=await identity('pattern-member');
 const ws=await workspace(owner),other=await workspace(outsider);
 const membership=await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:ws,user_id:member.id,role:'member',status:'active'});if(membership.status!==201)throw new Error('Membership failed');
 const workerInput={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,target_display_name:'Pattern Test Worker',target_role_labels:[],target_skill_tags:[],target_active:true,expected_version:0};
 const created=await rpc(serviceKey,'save_rev_scheduling_worker',workerInput);if(created.status!==200)throw new Error('Worker failed');const workerId=id(created.payload.worker_id);
 const input={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_timezone:'Europe/London',target_working_days:[5,1,3],target_start_local:'09:00',target_end_local:'17:00',target_effective_from:'2026-10-01',target_effective_until:null,expected_version:0};
 const save=(patch={},token=serviceKey)=>rpc(token,'save_rev_worker_working_pattern',{...input,...patch});
 const read=(token=owner.token)=>request(token,'GET',`/rest/v1/scheduling_worker_patterns?workspace_id=eq.${ws}&select=*`);
 check('NO_IMPLICIT_WORKER_AVAILABILITY',(await read()).rows.length===0);
 const race=await Promise.all([save(),save()]);check('CONCURRENT_PATTERN_CREATE_ONCE',race.every(r=>r.status===200)&&race[0].payload?.pattern_id===race[1].payload?.pattern_id&&(await read()).rows.length===1);
 check('CANONICAL_DAYS_AND_EFFECTIVE_DATE',JSON.stringify(race[0].payload?.working_days)==='[1,3,5]'&&race[0].payload?.effective_from==='2026-10-01'&&race[0].payload?.effective_until===null&&race[0].payload?.version===1);
 check('SAME_REQUEST_RETRY_SAFE',JSON.stringify((await save()).payload)===JSON.stringify(race[0].payload));
 check('CHANGED_REQUEST_DENIED',(await save({target_end_local:'16:00'})).status>=400);
 check('MEMBER_PATTERN_READ_DENIED',(await read(member.token)).status===200&&(await read(member.token)).rows.length===0);
 check('CROSS_TENANT_PATTERN_READ_DENIED',(await read(outsider.token)).status===200&&(await read(outsider.token)).rows.length===0);
 check('MEMBER_PATTERN_WRITE_DENIED',(await save({target_request_id:randomUUID(),initiating_user_id:member.id})).status>=400);
 check('FOREIGN_WORKER_PATTERN_DENIED',(await save({target_request_id:randomUUID(),target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 check('REQUEST_TENANT_COLLISION_DENIED',(await save({target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_PATTERN_RPC_DENIED',(await save({},token)).status>=400);
 for(const patch of [{target_working_days:[]},{target_working_days:[1,1]},{target_working_days:[0]},{target_working_days:[null]},{target_timezone:'Wrong/Zone'},{target_start_local:'9:00'},{target_end_local:'24:00'},{target_end_local:'09:00'},{target_effective_from:null},{target_effective_from:'infinity'},{target_effective_until:'2026-09-01'},{target_effective_until:'infinity'},{expected_version:-1}])check('INVALID_PATTERN_DENIED',(await save({...patch,target_request_id:randomUUID(),expected_version:patch.expected_version??1})).status>=400);
 const edits=await Promise.all([save({target_request_id:randomUUID(),expected_version:1,target_start_local:'10:00'}),save({target_request_id:randomUUID(),expected_version:1,target_start_local:'11:00'})]);check('CONCURRENT_PATTERN_UPDATE_ONCE',edits.filter(r=>r.status===200).length===1&&edits.filter(r=>r.status>=400).length===1);
 check('STALE_PATTERN_VERSION_DENIED',(await save({target_request_id:randomUUID(),expected_version:1})).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_PATTERN_READ_ALLOWED',(await read(member.token)).rows.length===1);
 check('OTHER_ACTOR_RETRY_DENIED',(await save({initiating_user_id:member.id})).status>=400);
 check('ADMIN_PATTERN_SAVE_ALLOWED',(await save({target_request_id:randomUUID(),expected_version:2,initiating_user_id:member.id,target_effective_until:'2026-12-31'})).status===200);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_PATTERN_DENIED',(await read(member.token)).rows.length===0&&(await save({target_request_id:randomUUID(),expected_version:3,initiating_user_id:member.id})).status>=400);
 const endpoint=`/rest/v1/scheduling_worker_patterns?workspace_id=eq.${ws}`;
 const inserted=await request(owner.token,'POST','/rest/v1/scheduling_worker_patterns',{workspace_id:ws,worker_id:workerId});
 check('DIRECT_BROWSER_PATTERN_WRITES_DENIED',inserted.status>=400&&(await request(owner.token,'PATCH',endpoint,{start_local:'08:00'})).status>=400&&(await request(owner.token,'DELETE',endpoint)).status>=400);
 check('PATTERN_AUDIT_EXACTLY_ONCE',sql(`select count(*) from public.audit_log where workspace_id='${id(ws)}' and resource_type='scheduling_worker_pattern';`)==='3');
 const failedId=randomUUID();
 const atomic=sql(`begin;
 create function pg_temp.refuse_pattern_audit() returns trigger language plpgsql as $$begin raise exception 'Local audit refusal';end$$;
 create trigger local_pattern_audit_refusal before insert on public.audit_log for each row when (new.resource_type='scheduling_worker_pattern') execute function pg_temp.refuse_pattern_audit();
 do $$begin begin perform public.save_rev_worker_working_pattern('${id(ws)}','${id(owner.id)}','${id(failedId)}','${id(workerId)}','Europe/London',array[1]::smallint[],'08:00','16:00','2026-10-01',null,3);exception when raise_exception then null;end;end$$;
 select case when (select version from public.scheduling_worker_patterns where workspace_id='${id(ws)}' and worker_id='${id(workerId)}')=3 and not exists(select 1 from rev_scheduling_private.pattern_requests where request_id='${id(failedId)}') then 'PATTERN_ATOMIC_PASS' else 'PATTERN_ATOMIC_FAIL' end;
 rollback;`);check('AUDIT_FAILURE_ROLLS_BACK_PATTERN',atomic.includes('PATTERN_ATOMIC_PASS'));
 const archived=await rpc(serviceKey,'save_rev_scheduling_worker',{...workerInput,target_request_id:randomUUID(),target_worker_id:workerId,target_active:false,expected_version:1});check('WORKER_ARCHIVE_ALLOWED',archived.status===200);
 check('INACTIVE_WORKER_PATTERN_SAVE_DENIED',(await save({target_request_id:randomUUID(),expected_version:3})).status>=400);
 check('PATTERN_HISTORY_RETAINED',(await read()).rows[0]?.version===3);
} catch {check('LOCAL_WORKER_PATTERN_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');check('WORKER_PATTERNS_LOCAL',failures===0);if(failures)process.exitCode=1;

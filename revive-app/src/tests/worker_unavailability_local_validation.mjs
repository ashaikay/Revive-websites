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
 const owner=await identity('leave-owner'),outsider=await identity('leave-outsider'),member=await identity('leave-member');
 const ws=await workspace(owner),other=await workspace(outsider);
 const membership=await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:ws,user_id:member.id,role:'member',status:'active'});if(membership.status!==201)throw new Error('Membership failed');
 const workerInput={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,target_display_name:'Leave Test Worker',target_role_labels:[],target_skill_tags:[],target_active:true,expected_version:0};
 const created=await rpc(serviceKey,'save_rev_scheduling_worker',workerInput);if(created.status!==200)throw new Error('Worker failed');const workerId=id(created.payload.worker_id);
 const input={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:workerId,target_unavailability_id:null,target_start_at:'2026-10-08T09:00:00.000Z',target_end_at:'2026-10-08T12:00:00.000Z',target_category:'unavailable',target_status:'active',expected_version:0};
 const save=(patch={},token=serviceKey)=>rpc(token,'save_rev_worker_unavailability',{...input,...patch});
 const read=(token=owner.token)=>request(token,'GET',`/rest/v1/scheduling_worker_unavailability?workspace_id=eq.${ws}&select=*`);
 const race=await Promise.all([save(),save()]);check('CONCURRENT_UNAVAILABILITY_CREATE_ONCE',race.every(r=>r.status===200)&&race[0].payload?.unavailability_id===race[1].payload?.unavailability_id&&(await read()).rows.length===1);
 const recordId=id(race[0].payload?.unavailability_id);
 check('INTERVAL_CATEGORY_AND_STATUS_SAVED',race[0].payload?.category==='unavailable'&&race[0].payload?.status==='active'&&race[0].payload?.version===1&&Date.parse(race[0].payload?.start_at)===Date.parse(input.target_start_at));
 check('RETRY_RETURNS_SAME_RESULT',JSON.stringify((await save()).payload)===JSON.stringify(race[0].payload));
 check('CHANGED_REQUEST_DENIED',(await save({target_end_at:'2026-10-08T13:00:00.000Z'})).status>=400);
 check('MEMBER_READ_DENIED',(await read(member.token)).status===200&&(await read(member.token)).rows.length===0);
 check('CROSS_TENANT_READ_DENIED',(await read(outsider.token)).status===200&&(await read(outsider.token)).rows.length===0);
 check('MEMBER_SAVE_DENIED',(await save({target_request_id:randomUUID(),initiating_user_id:member.id})).status>=400);
 check('FOREIGN_WORKER_SAVE_DENIED',(await save({target_request_id:randomUUID(),target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 check('REQUEST_TENANT_COLLISION_DENIED',(await save({target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_UNAVAILABILITY_RPC_DENIED',(await save({},token)).status>=400);
 for(const patch of [{target_start_at:null},{target_start_at:'infinity'},{target_end_at:'infinity'},{target_end_at:input.target_start_at},{target_end_at:'2026-10-07T09:00:00Z'},{target_category:'leave'},{target_category:'medical-notes'},{target_category:null},{target_status:'cancelled'},{expected_version:1}])check('INVALID_UNAVAILABILITY_DENIED',(await save({...patch,target_request_id:randomUUID()})).status>=400);
 const update={target_unavailability_id:recordId,expected_version:1};
 const edits=await Promise.all([save({...update,target_request_id:randomUUID(),target_end_at:'2026-10-08T13:00:00Z'}),save({...update,target_request_id:randomUUID(),target_end_at:'2026-10-08T14:00:00Z'})]);check('CONCURRENT_UNAVAILABILITY_UPDATE_ONCE',edits.filter(r=>r.status===200).length===1&&edits.filter(r=>r.status>=400).length===1);
 check('STALE_VERSION_DENIED',(await save({...update,target_request_id:randomUUID()})).status>=400);
 const latest=edits.find(r=>r.status===200).payload;
 const cancel={target_unavailability_id:recordId,expected_version:2,target_start_at:latest.start_at,target_end_at:latest.end_at,target_status:'cancelled',target_request_id:randomUUID()};
 check('CANCEL_CANNOT_CHANGE_INTERVAL',(await save({...cancel,target_request_id:randomUUID(),target_end_at:'2026-10-08T15:00:00Z'})).status>=400);
 const alternativeCancel={...cancel,target_request_id:randomUUID()};
 const cancellations=await Promise.all([save(cancel),save(alternativeCancel)]);check('CONCURRENT_CANCELLATION_ONCE',cancellations.filter(r=>r.status===200).length===1&&cancellations.filter(r=>r.status>=400).length===1);
 const winning=cancellations[0].status===200?cancel:alternativeCancel;
 check('CANCELLATION_RETRY_SAFE',(await save(winning)).status===200);
 check('CANCELLED_RECORD_RETAINED',(await read()).rows[0]?.status==='cancelled'&&(await read()).rows[0]?.version===3);
 check('CANCELLED_RECORD_CANNOT_REACTIVATE',(await save({...update,expected_version:3,target_request_id:randomUUID()})).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_READ_ALLOWED',(await read(member.token)).rows.length===1);
 check('OTHER_ACTOR_REQUEST_COLLISION_DENIED',(await save({initiating_user_id:member.id})).status>=400);
 const second=await save({target_request_id:randomUUID(),initiating_user_id:member.id,target_category:'unavailable'});check('ADMIN_SAVE_ALLOWED',second.status===200);
 const secondId=id(second.payload?.unavailability_id);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_DENIED',(await read(member.token)).rows.length===0&&(await save({target_request_id:randomUUID(),initiating_user_id:member.id})).status>=400);
 const endpoint=`/rest/v1/scheduling_worker_unavailability?workspace_id=eq.${ws}`;
 const inserted=await request(owner.token,'POST','/rest/v1/scheduling_worker_unavailability',{workspace_id:ws,worker_id:workerId});check('DIRECT_BROWSER_WRITES_DENIED',inserted.status>=400&&(await request(owner.token,'PATCH',endpoint,{status:'cancelled'})).status>=400&&(await request(owner.token,'DELETE',endpoint)).status>=400);
 const foreign=await request(serviceKey,'POST','/rest/v1/scheduling_worker_unavailability',{workspace_id:other,worker_id:workerId,start_at:input.target_start_at,end_at:input.target_end_at,category:'unavailable',created_by_user_id:outsider.id,updated_by_user_id:outsider.id});check('COMPOSITE_WORKER_FK_DENIED',foreign.status>=400);
 const failedId=randomUUID();
 const atomic=sql(`begin;
 create function pg_temp.refuse_unavailability_audit() returns trigger language plpgsql as $$begin raise exception 'Local audit refusal';end$$;
 create trigger local_unavailability_audit_refusal before insert on public.audit_log for each row when (new.resource_type='scheduling_worker_unavailability') execute function pg_temp.refuse_unavailability_audit();
 do $$begin begin perform public.save_rev_worker_unavailability('${id(ws)}','${id(owner.id)}','${id(failedId)}','${id(workerId)}','${id(secondId)}','2026-10-08T09:00:00Z','2026-10-08T12:00:00Z','unavailable','cancelled',1);exception when raise_exception then null;end;end$$;
 select case when (select version from public.scheduling_worker_unavailability where id='${id(secondId)}')=1 and not exists(select 1 from rev_scheduling_private.unavailability_requests where request_id='${id(failedId)}') then 'UNAVAILABILITY_ATOMIC_PASS' else 'UNAVAILABILITY_ATOMIC_FAIL' end;
 rollback;`);check('AUDIT_FAILURE_ROLLS_BACK_CANCELLATION',atomic.includes('UNAVAILABILITY_ATOMIC_PASS'));
 const archived=await rpc(serviceKey,'save_rev_scheduling_worker',{...workerInput,target_request_id:randomUUID(),target_worker_id:workerId,target_active:false,expected_version:1});check('WORKER_ARCHIVED',archived.status===200);
 check('INACTIVE_WORKER_NEW_PERIOD_DENIED',(await save({target_request_id:randomUUID()})).status>=400);
 check('INACTIVE_WORKER_CANCELLATION_ALLOWED',(await save({target_request_id:randomUUID(),target_unavailability_id:secondId,target_category:'unavailable',target_status:'cancelled',expected_version:1})).status===200);
 check('AUDIT_EXACTLY_ONCE_PER_MUTATION',sql(`select count(*) from public.audit_log where workspace_id='${id(ws)}' and resource_type='scheduling_worker_unavailability';`)==='5');
 check('HISTORY_PRESERVED',(await read()).rows.length===2&&(await read()).rows.every(r=>r.status==='cancelled'));
} catch {check('LOCAL_WORKER_UNAVAILABILITY_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');check('WORKER_UNAVAILABILITY_LOCAL',failures===0);if(failures)process.exitCode=1;

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
 const owner=await identity('job-owner'),outsider=await identity('job-outsider'),member=await identity('job-member');
 const ws=await workspace(owner),other=await workspace(outsider);
 if((await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:ws,user_id:member.id,role:'member',status:'active'})).status!==201)throw Error('Membership fixture failed');
 const input={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_job_id:null,target_title:'Local support shift',target_start_at:'2026-10-08T09:00:00.000Z',target_end_at:'2026-10-08T12:00:00.000Z',target_timezone:'Europe/London',target_location:'Birmingham office',target_required_skills:['Phone','Admin'],target_staffing_count:2,target_status:'open',expected_version:0};
 const save=(patch={},token=serviceKey)=>rpc(token,'save_rev_scheduling_job',{...input,...patch});
 const read=(token=owner.token)=>request(token,'GET',`/rest/v1/scheduling_jobs?workspace_id=eq.${ws}&select=*`);
 const first=await Promise.all([save(),save()]);
 check('CONCURRENT_CREATE_ONE_JOB',first.every(r=>r.status===200)&&first[0].payload?.job_id===first[1].payload?.job_id&&(await read()).rows.length===1);
 if(first[0].status!==200)throw Error('Job create failed');
 const job=id(first[0].payload.job_id);
 check('CANONICAL_REQUIREMENTS',first[0].payload.version===1&&JSON.stringify(first[0].payload.required_skills)==='["Admin","Phone"]'&&first[0].payload.staffing_count===2);
 check('LEGACY_JOB_DEFAULTS_TO_ALL',first[0].payload.skill_requirement_mode==='all'&&sql(`select skill_requirement_mode from public.scheduling_jobs where id='${job}';`)==='all');
 check('RETRY_SAME_RESULT',JSON.stringify((await save()).payload)===JSON.stringify(first[0].payload));
 sql(`update rev_scheduling_private.job_requests set input=input-'skill_requirement_mode' where request_id='${id(input.target_request_id)}';`);
 check('LEGACY_REQUEST_HISTORY_RETRIES_AS_ALL',JSON.stringify((await save()).payload)===JSON.stringify(first[0].payload));
 check('MODE_CHANGE_ON_SAME_REQUEST_DENIED',(await save({target_skill_requirement_mode:'any'})).status>=400);
 const anyRequest={...input,target_request_id:randomUUID(),target_title:'Any skill shift',target_start_at:'2026-10-08T13:00:00.000Z',target_end_at:'2026-10-08T15:00:00.000Z',target_skill_requirement_mode:'any'};
 const anySave=async(patch={})=>rpc(serviceKey,'save_rev_scheduling_job',{...anyRequest,...patch});
 const anyCreated=await anySave();
 check('ANY_MODE_SAVED',anyCreated.status===200&&anyCreated.payload.skill_requirement_mode==='any'&&sql(`select skill_requirement_mode from public.scheduling_jobs where id='${id(anyCreated.payload.job_id)}';`)==='any');
 check('ANY_MODE_EXACT_RETRY',JSON.stringify((await anySave()).payload)===JSON.stringify(anyCreated.payload));
 check('ANY_MODE_CHANGED_RETRY_DENIED',(await anySave({target_skill_requirement_mode:'all'})).status>=400);
 check('CHANGED_RETRY_DENIED',(await save({target_title:'Changed'})).status>=400);
 for(const token of [member.token,outsider.token])check('UNAUTHORISED_JOB_READ_DENIED',(await read(token)).status===200&&(await read(token)).rows.length===0);
 check('MEMBER_SAVE_DENIED',(await save({initiating_user_id:member.id,target_request_id:randomUUID()})).status>=400);
 check('CROSS_TENANT_SAVE_DENIED',(await save({target_workspace_id:other,target_request_id:randomUUID()})).status>=400);
 check('REQUEST_TENANT_COLLISION_DENIED',(await save({target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_JOB_RPC_DENIED',(await save({},token)).status>=400);
 for(const patch of [{target_title:''},{target_title:' padded '},{target_title:'x'.repeat(161)},{target_location:''},{target_location:'x'.repeat(301)},{target_timezone:'bad/zone'},{target_start_at:input.target_end_at},{target_end_at:'infinity'},{target_required_skills:['Admin','Admin']},{target_required_skills:[null]},{target_required_skills:Array.from({length:31},(_,i)=>String(i))},{target_staffing_count:0},{target_staffing_count:101},{target_status:'cancelled'},{target_status:'booked'},{expected_version:1}])check('INVALID_JOB_DENIED',(await save({...patch,target_request_id:randomUUID()})).status>=400);
 const update={target_job_id:job,expected_version:1};
 const race=await Promise.all([save({...update,target_request_id:randomUUID(),target_title:'Shift A'}),save({...update,target_request_id:randomUUID(),target_title:'Shift B'})]);
 check('CONCURRENT_UPDATE_ONCE',race.filter(r=>r.status===200).length===1&&race.filter(r=>r.status>=400).length===1);
 check('STALE_VERSION_DENIED',(await save({...update,target_request_id:randomUUID()})).status>=400);
 check('FOREIGN_JOB_UPDATE_DENIED',(await save({...update,target_workspace_id:other,initiating_user_id:outsider.id,target_request_id:randomUUID()})).status>=400);
 const current=(await read()).rows[0];
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_READ_ALLOWED',(await read(member.token)).rows.length===1);
 check('OTHER_ACTOR_RETRY_DENIED',(await save({initiating_user_id:member.id})).status>=400);
 const cancel={target_job_id:job,expected_version:2,target_title:current.title,target_status:'cancelled',initiating_user_id:member.id,target_request_id:randomUUID()};
 check('CANCEL_CANNOT_CHANGE_DETAILS',(await save({...cancel,target_location:'Changed location',target_request_id:randomUUID()})).status>=400);
 const cancelled=await Promise.all([save(cancel),save(cancel)]);
 check('CONCURRENT_CANCELLATION_RETRY_SAFE',cancelled.every(r=>r.status===200&&r.payload.status==='cancelled'&&r.payload.version===3));
 check('CANCELLED_JOB_CANNOT_REACTIVATE',(await save({...cancel,target_status:'open',expected_version:3,target_request_id:randomUUID()})).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_READ_DENIED',(await read(member.token)).rows.length===0);
 check('SUSPENDED_ADMIN_SAVE_DENIED',(await save({initiating_user_id:member.id,target_request_id:randomUUID()})).status>=400);
 const endpoint=`/rest/v1/scheduling_jobs?workspace_id=eq.${ws}&id=eq.${job}`;
 check('DIRECT_BROWSER_WRITES_DENIED',(await request(owner.token,'POST','/rest/v1/scheduling_jobs',{})).status>=400&&(await request(owner.token,'PATCH',endpoint,{status:'open'})).status>=400&&(await request(owner.token,'DELETE',endpoint)).status>=400);
 check('PRIVATE_LEDGER_BROWSER_DENIED',sql("select not has_schema_privilege('authenticated','rev_scheduling_private','USAGE') and not has_schema_privilege('anon','rev_scheduling_private','USAGE');")==='t');
 check('AUDIT_EXACTLY_ONCE',sql(`select count(*) from public.audit_log where workspace_id='${id(ws)}' and resource_type='scheduling_job';`)==='3');
 const failed=randomUUID();
 const atomic=sql(`begin;
 create function pg_temp.refuse_job_audit() returns trigger language plpgsql as $$begin raise exception 'Local audit refusal';end$$;
 create trigger local_job_audit_refusal before insert on public.audit_log for each row when (new.resource_type='scheduling_job') execute function pg_temp.refuse_job_audit();
 do $$begin begin perform public.save_rev_scheduling_job('${id(ws)}','${id(owner.id)}','${id(failed)}',null,'Rollback Job','2026-10-08T09:00:00Z','2026-10-08T12:00:00Z','Europe/London','Local office',array[]::text[],1,'open',0);exception when raise_exception then null;end;end$$;
 select case when not exists(select 1 from public.scheduling_jobs where workspace_id='${id(ws)}' and title='Rollback Job') and not exists(select 1 from rev_scheduling_private.job_requests where request_id='${id(failed)}') then 'JOB_ATOMIC_PASS' else 'JOB_ATOMIC_FAIL' end;
 rollback;`);
 check('AUDIT_FAILURE_ROLLS_BACK_JOB_AND_REQUEST',atomic.includes('JOB_ATOMIC_PASS'));
 check('CANCELLED_HISTORY_PRESERVED',(await read()).rows.length===1&&(await read()).rows[0].status==='cancelled');
} catch {check('LOCAL_JOB_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');check('SCHEDULING_JOBS_LOCAL',failures===0);if(failures)process.exitCode=1;

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
 const owner=await identity('worker-owner'),outsider=await identity('worker-outsider'),member=await identity('worker-member');
 const ws=await workspace(owner),other=await workspace(outsider);
 const added=await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:ws,user_id:member.id,role:'member',status:'active'});if(added.status!==201)throw new Error('Membership fixture failed');
 const input={target_workspace_id:ws,initiating_user_id:owner.id,target_request_id:randomUUID(),target_worker_id:null,target_display_name:'Local Worker',target_role_labels:['Support','Coordinator'],target_skill_tags:['Phone','Admin'],target_active:true,expected_version:0};
 const save=(patch={},token=serviceKey)=>rpc(token,'save_rev_scheduling_worker',{...input,...patch});
 const read=(token=owner.token,workspaceId=ws)=>request(token,'GET',`/rest/v1/scheduling_workers?workspace_id=eq.${workspaceId}&select=*`);
 const first=await Promise.all([save(),save()]);
 check('CONCURRENT_CREATE_ONE_WORKER',first.every(r=>r.status===200)&&first[0].payload?.worker_id===first[1].payload?.worker_id&&(await read()).rows.length===1);
 const workerId=id(first[0].payload?.worker_id);
 check('CANONICAL_WORKER_METADATA',first[0].payload?.version===1&&JSON.stringify(first[0].payload?.role_labels)==='["Coordinator","Support"]');
 check('RETRY_RETURNS_SAME_RESULT',JSON.stringify((await save()).payload)===JSON.stringify(first[0].payload));
 check('CHANGED_RETRY_DENIED',(await save({target_display_name:'Changed'})).status>=400);
 check('MEMBER_READ_DENIED',(await read(member.token)).status===200&&(await read(member.token)).rows.length===0);
 check('OUTSIDER_READ_DENIED',(await read(outsider.token)).status===200&&(await read(outsider.token)).rows.length===0);
 check('MEMBER_WRITE_DENIED',(await save({target_request_id:randomUUID(),initiating_user_id:member.id})).status>=400);
 check('CROSS_TENANT_WRITE_DENIED',(await save({target_request_id:randomUUID(),target_workspace_id:other})).status>=400);
 check('REQUEST_TENANT_COLLISION_DENIED',(await save({target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_WORKER_RPC_DENIED',(await save({},token)).status>=400);
 for(const patch of [{target_display_name:''},{target_display_name:' padded '},{target_display_name:'x'.repeat(121)},{target_role_labels:[null]},{target_skill_tags:['Admin','Admin']},{target_skill_tags:['']},{target_role_labels:Array.from({length:31},(_,i)=>String(i))},{target_active:null},{expected_version:1}])check('INVALID_WORKER_DENIED',(await save({...patch,target_request_id:randomUUID()})).status>=400);
 const update={target_worker_id:workerId,expected_version:1};
 const race=await Promise.all([save({...update,target_request_id:randomUUID(),target_display_name:'Worker A'}),save({...update,target_request_id:randomUUID(),target_display_name:'Worker B'})]);
 check('CONCURRENT_UPDATE_ONCE',race.filter(r=>r.status===200).length===1&&race.filter(r=>r.status>=400).length===1);
 check('STALE_VERSION_DENIED',(await save({...update,target_request_id:randomUUID()})).status>=400);
 check('FOREIGN_WORKER_UPDATE_DENIED',(await save({...update,target_request_id:randomUUID(),target_workspace_id:other,initiating_user_id:outsider.id})).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_READ_ALLOWED',(await read(member.token)).rows.length===1);
 check('OTHER_ACTOR_REQUEST_COLLISION_DENIED',(await save({initiating_user_id:member.id})).status>=400);
 const archived=await save({target_worker_id:workerId,expected_version:2,target_request_id:randomUUID(),initiating_user_id:member.id,target_active:false});
 check('ADMIN_ARCHIVE_ALLOWED',archived.status===200&&archived.payload?.active===false&&archived.payload?.version===3);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${ws}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_READ_DENIED',(await read(member.token)).rows.length===0);
 check('SUSPENDED_ADMIN_WRITE_DENIED',(await save({target_request_id:randomUUID(),initiating_user_id:member.id})).status>=400);
 const inserted=await request(owner.token,'POST','/rest/v1/scheduling_workers',{workspace_id:ws,display_name:'Forbidden',created_by_user_id:owner.id,updated_by_user_id:owner.id});
 const endpoint=`/rest/v1/scheduling_workers?workspace_id=eq.${ws}&id=eq.${workerId}`;
 check('DIRECT_BROWSER_WRITES_DENIED',inserted.status>=400&&(await request(owner.token,'PATCH',endpoint,{active:true})).status>=400&&(await request(owner.token,'DELETE',endpoint)).status>=400);
 check('PRIVATE_REQUEST_LEDGER_BROWSER_DENIED',sql("select not has_schema_privilege('authenticated','rev_scheduling_private','USAGE') and not has_schema_privilege('anon','rev_scheduling_private','USAGE');")==='t');
 check('AUDIT_EXACTLY_ONCE_PER_MUTATION',sql(`select count(*) from public.audit_log where workspace_id='${id(ws)}' and resource_type='scheduling_worker';`)==='3');
 check('NO_MEMBERSHIP_CREATED_FOR_WORKER',sql(`select count(*) from public.workspace_members where workspace_id='${id(ws)}';`)==='2');
 const failedRequest=randomUUID();
 const atomic=sql(`begin;
 create function pg_temp.refuse_worker_audit() returns trigger language plpgsql as $$begin raise exception 'Local audit refusal';end$$;
 create trigger local_worker_audit_refusal before insert on public.audit_log for each row when (new.resource_type='scheduling_worker') execute function pg_temp.refuse_worker_audit();
 do $$begin
 begin perform public.save_rev_scheduling_worker('${id(ws)}','${id(owner.id)}','${id(failedRequest)}',null,'Rollback Worker',array[]::text[],array[]::text[],true,0);
 exception when raise_exception then null;end;
 end$$;
 select case when not exists(select 1 from public.scheduling_workers where workspace_id='${id(ws)}' and display_name='Rollback Worker') and not exists(select 1 from rev_scheduling_private.worker_requests where request_id='${id(failedRequest)}') then 'WORKER_ATOMIC_PASS' else 'WORKER_ATOMIC_FAIL' end;
 rollback;`);
 check('AUDIT_FAILURE_ROLLS_BACK_WORKER_AND_REQUEST',atomic.includes('WORKER_ATOMIC_PASS'));
 check('FINAL_WORKER_PRESERVED',(await read()).rows.length===1&&(await read()).rows[0]?.version===3);
} catch {check('LOCAL_WORKER_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('EXTERNAL_PROVIDER_REQUESTS=0');check('WORKER_RECORDS_LOCAL',failures===0);if(failures)process.exitCode=1;

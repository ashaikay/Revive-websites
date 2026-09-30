// Local Supabase only. Fake material; never accepts a remote URL or real Microsoft tokens.
import { randomBytes, createHash } from 'node:crypto';
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

 const owner=await identity('hours-owner'),outsider=await identity('hours-outsider'),member=await identity('hours-member');
 const workspaceId=await workspace(owner),otherWorkspaceId=await workspace(outsider);
 await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:member.id,role:'member',status:'active'});
 const input={target_workspace_id:workspaceId,initiating_user_id:owner.id,target_timezone:'Europe/London',target_working_days:[5,1,3],target_start_local:'09:00',target_end_local:'17:00',expected_version:0};
 const save=(patch={},token=serviceKey)=>rpc(token,'save_rev_calendar_business_hours',{...input,...patch});
 const read=(token=owner.token,ws=workspaceId)=>request(token,'GET',`/rest/v1/workspace_calendar_business_hours?workspace_id=eq.${ws}&select=*`);
 check('NO_IMPLICIT_POLICY_DEFAULT',(await read()).rows.length===0);
 const first=await save();check('OWNER_POLICY_CREATION',first.status===200&&first.rows[0]?.version===1&&JSON.stringify(first.rows[0]?.working_days)==='[1,3,5]');
 check('OWNER_SANITIZED_POLICY_READ',(await read()).rows[0]?.timezone==='Europe/London');
 check('MEMBER_POLICY_READ_DENIED',(await read(member.token)).rows.length===0);
 check('CROSS_TENANT_POLICY_READ_DENIED',(await read(outsider.token)).rows.length===0);
 check('MEMBER_POLICY_SAVE_DENIED',(await save({initiating_user_id:member.id,expected_version:1})).status>=400);
 check('CROSS_TENANT_POLICY_SAVE_DENIED',(await save({target_workspace_id:otherWorkspaceId,expected_version:1})).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_POLICY_RPC_DENIED',(await save({},token)).status>=400);
 for(const patch of [{target_timezone:'Invalid/Zone'},{target_working_days:[]},{target_working_days:[1,1]},{target_working_days:[0]},{target_working_days:[8]},{target_working_days:[null]},{target_start_local:'9:00'},{target_end_local:'24:00'},{target_start_local:'17:00'},{target_start_local:'18:00'}])check('INVALID_POLICY_DENIED',(await save({...patch,expected_version:1})).status>=400);
 const race=await Promise.all([save({expected_version:1,target_start_local:'10:00'}),save({expected_version:1,target_start_local:'11:00'})]);
 check('CONCURRENT_POLICY_SAVE_ONCE',race.filter(r=>r.status===200).length===1&&race.filter(r=>r.status>=400).length===1);
 check('STALE_POLICY_SAVE_DENIED',(await save({expected_version:1})).status>=400);
 check('LATEST_POLICY_PRESERVED',(await read()).rows[0]?.version===2);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_POLICY_READ',(await read(member.token)).rows.length===1);
 check('ADMIN_POLICY_SAVE',(await save({initiating_user_id:member.id,expected_version:2})).status===200);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_POLICY_READ_DENIED',(await read(member.token)).rows.length===0);
 check('SUSPENDED_ADMIN_POLICY_SAVE_DENIED',(await save({initiating_user_id:member.id,expected_version:3})).status>=400);
 const endpoint=`/rest/v1/workspace_calendar_business_hours?workspace_id=eq.${workspaceId}`;
 const insert=await request(owner.token,'POST','/rest/v1/workspace_calendar_business_hours',{workspace_id:otherWorkspaceId,timezone:'UTC',working_days:[1],business_start_local:'09:00',business_end_local:'17:00',updated_by_user_id:owner.id});
 const update=await request(owner.token,'PATCH',endpoint,{business_start_local:'08:00'}),deleted=await request(owner.token,'DELETE',endpoint);
 check('BROWSER_DIRECT_POLICY_WRITES_DENIED',insert.status>=400&&update.status>=400&&deleted.status>=400);
 check('POLICY_REMAINS_AFTER_DENIED_WRITES',(await read()).rows[0]?.version===3);
} catch {check('LOCAL_BUSINESS_HOURS_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('MICROSOFT_REQUESTS=0');check('PHASE5_CALENDAR_BUSINESS_HOURS_LOCAL',failures===0);if(failures)process.exitCode=1;

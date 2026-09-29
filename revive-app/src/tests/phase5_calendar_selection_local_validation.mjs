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
 const owner=await identity('selection-owner'),outsider=await identity('selection-outsider'),member=await identity('selection-member');
 const workspaceId=await workspace(owner),otherWorkspaceId=await workspace(outsider);
 await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:member.id,role:'member',status:'active'});
 const connectionId=crypto.randomUUID(),bound={target_workspace_id:workspaceId,target_connection_id:connectionId,initiating_user_id:owner.id};
 await rpc(serviceKey,'create_rev_calendar_connection',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:connectionId});
 const credential=await rpc(serviceKey,'store_rev_calendar_credential',{...bound,refresh_token:'fake-selection-refresh',expected_revision:0});
 const reference=credential.rows[0]?.credential_reference;
 const saved=await rpc(serviceKey,'save_rev_calendar_discovery',{...bound,target_credential_reference:reference,expected_revision:1,target_account_reference:'selection@example.test',target_timezone:'Europe/London',discovered_calendars:[{providerCalendarReference:'default',displayName:'Calendar',ownerAddress:'selection@example.test',isDefault:true},{providerCalendarReference:'work',displayName:'Work',ownerAddress:'selection@example.test',isDefault:false}]});
 if(saved.status!==200)throw new Error('Discovery fixture failed');
 const list=()=>request(serviceKey,'GET',`/rest/v1/workspace_calendars?workspace_id=eq.${workspaceId}&select=id,is_selected&order=display_name`);
 const ids=(await list()).rows.map(r=>id(r.id));
 const select=(calendarId,actor=owner.id,workspace=workspaceId)=>rpc(serviceKey,'select_rev_workspace_calendar',{target_workspace_id:workspace,target_calendar_id:calendarId,initiating_user_id:actor});
 const bindingsBefore=await request(serviceKey,'GET','/rest/v1/rev_meeting_calendar_bindings?select=*&order=workspace_id');
 check('OWNER_SELECTION_ALLOWED',(await select(ids[0])).status===200);
 check('REPEAT_SELECTION_ALLOWED',(await select(ids[0])).status===200);
 check('SWITCH_SELECTION_ALLOWED',(await select(ids[1])).status===200);
 check('ONE_SELECTION_AFTER_SWITCH',(await list()).rows.filter(r=>r.is_selected).length===1);
 const raced=await Promise.all([select(ids[0]),select(ids[1])]);
 check('CONCURRENT_SELECTION_SERIALIZED',raced.every(r=>r.status===200)&&(await list()).rows.filter(r=>r.is_selected).length===1);
 check('MEMBER_SELECTION_DENIED',(await select(ids[0],member.id)).status>=400);
 check('CROSS_TENANT_SELECTION_DENIED',(await select(ids[0],outsider.id,otherWorkspaceId)).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${member.id}`,{role:'admin'});
 check('ADMIN_SELECTION_ALLOWED',(await select(ids[0],member.id)).status===200);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${member.id}`,{status:'suspended'});
 check('SUSPENDED_ADMIN_SELECTION_DENIED',(await select(ids[0],member.id)).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_calendars?id=eq.${ids[1]}`,{active:false,is_selected:false});
 check('INACTIVE_CALENDAR_SELECTION_DENIED',(await select(ids[1])).status>=400);
 for(const token of [anonKey,owner.token])check('BROWSER_SELECTION_RPC_DENIED',(await rpc(token,'select_rev_workspace_calendar',{target_workspace_id:workspaceId,target_calendar_id:ids[0],initiating_user_id:owner.id})).status>=400);
 const bindingsAfter=await request(serviceKey,'GET','/rest/v1/rev_meeting_calendar_bindings?select=*&order=workspace_id');check('SELECTION_LEAVES_MEETING_BINDINGS_UNCHANGED',bindingsBefore.status===200&&JSON.stringify(bindingsBefore.payload)===JSON.stringify(bindingsAfter.payload));
 await rpc(serviceKey,'revoke_rev_calendar_credential',{target_workspace_id:workspaceId,target_connection_id:connectionId});
 check('REVOKED_CONNECTION_SELECTION_DENIED',(await select(ids[0])).status>=400);
 check('REVOCATION_CLEARS_SELECTION',(await list()).rows.every(r=>r.is_selected===false));
} catch {check('LOCAL_SELECTION_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('MICROSOFT_REQUESTS=0');check('PHASE5_CALENDAR_SELECTION_LOCAL',failures===0);if(failures)process.exitCode=1;

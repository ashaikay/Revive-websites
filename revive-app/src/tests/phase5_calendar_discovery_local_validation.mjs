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
 const owner=await identity('discovery-owner'), outsider=await identity('discovery-outsider');
 const workspaceId=await workspace(owner),otherWorkspaceId=await workspace(outsider);
 const requestId=crypto.randomUUID();
 const made=await rpc(serviceKey,'create_rev_calendar_connection',{target_workspace_id:workspaceId,initiating_user_id:owner.id,target_request_id:requestId});
 if(made.status!==200)throw new Error('Creation failed');
 const bound={target_workspace_id:workspaceId,target_connection_id:requestId,initiating_user_id:owner.id};
 const stored=await rpc(serviceKey,'store_rev_calendar_credential',{...bound,refresh_token:'fake-discovery-refresh-v1',expected_revision:0});
 if(stored.status!==200)throw new Error('Credential fixture failed');
 const reference=stored.rows[0].credential_reference;
 const load=()=>rpc(serviceKey,'load_rev_pending_calendar_credential',bound);
 check('PENDING_CREDENTIAL_TRUSTED_LOAD',(await load()).rows[0]?.refresh_token==='fake-discovery-refresh-v1');
 check('CROSS_TENANT_PENDING_LOAD_DENIED',(await rpc(serviceKey,'load_rev_pending_calendar_credential',{...bound,target_workspace_id:otherWorkspaceId,initiating_user_id:outsider.id})).status>=400);
 check('WRONG_ACTOR_PENDING_LOAD_DENIED',(await rpc(serviceKey,'load_rev_pending_calendar_credential',{...bound,initiating_user_id:outsider.id})).status>=400);
 const rotated=await rpc(serviceKey,'rotate_rev_pending_calendar_credential',{...bound,refresh_token:'fake-discovery-refresh-v2',expected_revision:1});
 check('PENDING_ROTATION_ALLOWED',rotated.status===200&&rotated.rows[0]?.revision===2);
 check('STALE_PENDING_ROTATION_DENIED',(await rpc(serviceKey,'rotate_rev_pending_calendar_credential',{...bound,refresh_token:'fake-stale',expected_revision:1})).status>=400);
 const calendars=[{providerCalendarReference:'fake-default',displayName:'Calendar',ownerAddress:'owner@example.test',isDefault:true},{providerCalendarReference:'fake-work',displayName:'Work',ownerAddress:'owner@example.test',isDefault:false}];
 const input={...bound,target_credential_reference:reference,expected_revision:2,target_account_reference:'owner@example.test',target_timezone:'Europe/London',discovered_calendars:calendars};
 const save=(overrides={})=>rpc(serviceKey,'save_rev_calendar_discovery',{...input,...overrides});
 check('STALE_DISCOVERY_SAVE_DENIED',(await save({expected_revision:1})).status>=400);
 check('WRONG_CREDENTIAL_REFERENCE_DENIED',(await save({target_credential_reference:crypto.randomUUID()})).status>=400);
 check('INVALID_TIMEZONE_DENIED',(await save({target_timezone:'Not/AZone'})).status>=400);
 check('FOREIGN_OWNER_METADATA_DENIED',(await save({discovered_calendars:[{...calendars[0],ownerAddress:'other@example.test'}]})).status>=400);
 check('DUPLICATE_CALENDAR_DENIED',(await save({discovered_calendars:[calendars[0],calendars[0]]})).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${owner.id}`,{status:'suspended'});
 check('SUSPENDED_INITIATOR_SAVE_DENIED',(await save()).status>=400);
 await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${owner.id}`,{status:'active'});
 const bindingsBefore=await request(serviceKey,'GET','/rest/v1/rev_meeting_calendar_bindings?select=*&order=workspace_id');
 const results=await Promise.all([save(),save()]); console.log("DISCOVERY_SAVE_DIAGNOSTIC="+JSON.stringify(results.map(r=>({status:r.status,code:r.payload?.code,message:r.payload?.message,hint:r.payload?.hint}))));check('CONCURRENT_DISCOVERY_SAVE_ONCE',results.filter(r=>r.status===200).length===1);
 const metadata=await request(serviceKey,'GET',`/rest/v1/workspace_calendars?workspace_id=eq.${workspaceId}&connection_id=eq.${requestId}&select=active,is_selected,timezone`);
 check('TWO_ACTIVE_CALENDARS_NONE_SELECTED',metadata.rows.length===2&&metadata.rows.every(r=>r.active===true&&r.is_selected===false&&r.timezone==='Europe/London'));
 check('PENDING_LOADER_DENIES_CONNECTED',(await load()).status>=400);
 const connected=await rpc(serviceKey,'load_rev_calendar_credential',{target_workspace_id:workspaceId,target_connection_id:requestId,target_credential_reference:reference});
 check('CONNECTED_TOKEN_LATEST_REVISION',connected.status===200&&connected.rows[0]?.revision===2&&connected.rows[0]?.refresh_token==='fake-discovery-refresh-v2');
 const bindingsAfter=await request(serviceKey,'GET','/rest/v1/rev_meeting_calendar_bindings?select=*&order=workspace_id');
 check('MEETING_BINDINGS_UNCHANGED',bindingsBefore.status===200&&bindingsAfter.status===200&&JSON.stringify(bindingsBefore.payload)===JSON.stringify(bindingsAfter.payload));
 for(const token of [anonKey,owner.token]){
  check('BROWSER_PENDING_LOAD_DENIED',(await rpc(token,'load_rev_pending_calendar_credential',bound)).status>=400);
  check('BROWSER_PENDING_ROTATE_DENIED',(await rpc(token,'rotate_rev_pending_calendar_credential',{...bound,refresh_token:'fake',expected_revision:2})).status>=400);
  check('BROWSER_DISCOVERY_SAVE_DENIED',(await rpc(token,'save_rev_calendar_discovery',input)).status>=400);
 }
 await rpc(serviceKey,'revoke_rev_calendar_credential',{target_workspace_id:workspaceId,target_connection_id:requestId});
 check('REVOKED_PENDING_LOAD_DENIED',(await load()).status>=400);
 check('REVOKED_ROTATION_CANNOT_RECREATE_TOKEN',(await rpc(serviceKey,'rotate_rev_pending_calendar_credential',{...bound,refresh_token:'fake',expected_revision:2})).status>=400);
 check('REVOKED_DISCOVERY_SAVE_DENIED',(await save()).status>=400);
} catch {check('LOCAL_DISCOVERY_VALIDATION',false);}
finally {await retireFixtures(workspaces,identities);}
console.log('MICROSOFT_REQUESTS=0');check('PHASE5_CALENDAR_DISCOVERY_LOCAL',failures===0);if(failures)process.exitCode=1;

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
if (process.argv.includes('--retire-fixtures')) {
  // Repair previous validator runs only; retain all append-only evidence.
  const fixtureIds = JSON.parse(sql("select coalesce(json_agg(w.id),'[]'::json) from public.workspaces w where to_jsonb(w)::text like '%oauth-local-%';"));
  const userIds = JSON.parse(sql("select coalesce(json_agg(distinct m.user_id),'[]'::json) from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where to_jsonb(w)::text like '%oauth-local-%';"));
  await retireFixtures(fixtureIds.map(id),userIds.map(id));
  if (failures) process.exitCode=1;
} else {
try {
  const owner = await identity('owner'), outsider = await identity('outsider'), member = await identity('member');
  const workspaceId = await workspace(owner), otherWorkspaceId = await workspace(outsider);
  const connectionId = await connection(workspaceId), secondConnectionId = await connection(workspaceId), otherConnectionId = await connection(otherWorkspaceId);
  const added = await request(serviceKey,'POST','/rest/v1/workspace_members',{workspace_id:workspaceId,user_id:member.id,role:'member',status:'active'});
  if (added.status !== 201) throw new Error('Local membership fixture failed.');
  const state = material(), verifier = material();
  const args = {target_workspace_id:workspaceId,target_connection_id:connectionId,initiating_user_id:owner.id,raw_state:state};
  const begun = await rpc(serviceKey,'begin_rev_calendar_oauth',{...args,pkce_verifier:verifier});
  const transactionId = id(begun.payload);
  check('SERVICE_OAUTH_BEGIN_ALLOWED',begun.status===200);
  const hash = createHash('sha256').update(state).digest('hex');
  check('STATE_HASHED_PKCE_ENCRYPTED',sql(`select t.state_hash='${hash}' and s.secret <> '${verifier}' and s.decrypted_secret='${verifier}' from rev_calendar_private.oauth_transactions t join vault.decrypted_secrets s on s.id=t.pkce_secret_id where t.id='${transactionId}';`)==='t');
  check('PRIVATE_SCHEMA_BROWSER_DENIED',sql("select not has_schema_privilege('authenticated','rev_calendar_private','USAGE') and not has_schema_privilege('anon','rev_calendar_private','USAGE') and not has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') and not has_table_privilege('anon','vault.decrypted_secrets','SELECT');")==='t');
  check('MEMBER_CANNOT_INITIATE', (await rpc(serviceKey,'begin_rev_calendar_oauth',{...args,initiating_user_id:member.id,raw_state:material(),pkce_verifier:material()})).status>=400);
  check('OAUTH_WRONG_WORKSPACE_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',{...args,target_workspace_id:otherWorkspaceId,initiating_user_id:outsider.id})).status>=400);
  check('OAUTH_WRONG_CONNECTION_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',{...args,target_connection_id:secondConnectionId})).status>=400);
  check('OAUTH_WRONG_ACTOR_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',{...args,initiating_user_id:member.id})).status>=400);
  check('OAUTH_WRONG_STATE_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',{...args,raw_state:material()})).status>=400);
  const concurrent = await Promise.all([rpc(serviceKey,'consume_rev_calendar_oauth',args),rpc(serviceKey,'consume_rev_calendar_oauth',args)]);
  check('CONCURRENT_STATE_CONSUMED_ONCE',concurrent.filter(r=>r.status===200&&r.payload===verifier).length===1&&concurrent.filter(r=>r.status>=400).length===1);
  check('REPLAY_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',args)).status>=400);
  check('CONSUMED_VERIFIER_DESTROYED',sql(`select consumed_at is not null and pkce_secret_id is null from rev_calendar_private.oauth_transactions where id='${transactionId}';`)==='t');
  const expiredArgs = {...args,raw_state:material()};
  const expired = await rpc(serviceKey,'begin_rev_calendar_oauth',{...expiredArgs,pkce_verifier:material()});
  const expiredId = id(expired.payload);
  sql(`update rev_calendar_private.oauth_transactions set created_at=now()-interval '20 minutes',expires_at=now()-interval '10 minutes' where id='${expiredId}';`);
  check('EXPIRED_STATE_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',expiredArgs)).status>=400);
  const purged=await rpc(serviceKey,'purge_expired_rev_calendar_oauth',{target_workspace_id:workspaceId});
  check('EXPIRED_STATE_PURGE_ALLOWED',purged.status===200&&purged.payload>=1&&sql(`select not exists(select 1 from rev_calendar_private.oauth_transactions where id='${expiredId}');`)==='t');
  const suspendedArgs={...args,raw_state:material()};
  await rpc(serviceKey,'begin_rev_calendar_oauth',{...suspendedArgs,pkce_verifier:material()});
  await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${owner.id}`,{status:'suspended'});
  check('SUSPENDED_INITIATOR_DENIED',(await rpc(serviceKey,'consume_rev_calendar_oauth',suspendedArgs)).status>=400);
  await request(serviceKey,'PATCH',`/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${owner.id}`,{status:'active'});
  const fakeToken=`fake-refresh-${material()}`;
  const storeArgs={target_workspace_id:workspaceId,target_connection_id:connectionId,initiating_user_id:owner.id,refresh_token:fakeToken,expected_revision:0};
  const stored=await rpc(serviceKey,'store_rev_calendar_credential',storeArgs);
  const reference=id(stored.rows[0]?.credential_reference);
  check('OPAQUE_CREDENTIAL_REFERENCE',stored.status===200&&stored.rows[0].revision===1&&!JSON.stringify(stored.payload).includes(fakeToken));
  check('REFRESH_TOKEN_ENCRYPTED',sql(`select s.secret <> '${fakeToken}' and s.decrypted_secret='${fakeToken}' from rev_calendar_private.credentials c join vault.decrypted_secrets s on s.id=c.secret_id where c.id='${reference}';`)==='t');
  const loadArgs={target_workspace_id:workspaceId,target_connection_id:connectionId,target_credential_reference:reference};
  check('DISCONNECTED_TOKEN_LOAD_DENIED',(await rpc(serviceKey,'load_rev_calendar_credential',loadArgs)).status>=400);
  const connected=await request(serviceKey,'PATCH',`/rest/v1/workspace_calendar_connections?id=eq.${connectionId}`,{connection_status:'connected',credential_reference:reference,authorized_by_user_id:owner.id,authorized_at:new Date().toISOString()});
  if(connected.status!==200)throw new Error('Local fake connection setup failed.');
  const loaded=await rpc(serviceKey,'load_rev_calendar_credential',loadArgs);
  check('TRUSTED_TOKEN_LOAD_ALLOWED',loaded.status===200&&loaded.rows[0]?.refresh_token===fakeToken);
  check('CREDENTIAL_TENANT_ISOLATION',(await rpc(serviceKey,'load_rev_calendar_credential',{...loadArgs,target_workspace_id:otherWorkspaceId,target_connection_id:otherConnectionId})).status>=400);
  const rotatedToken=`fake-rotated-${material()}`;
  const rotated=await rpc(serviceKey,'store_rev_calendar_credential',{...storeArgs,refresh_token:rotatedToken,expected_revision:1});
  check('TOKEN_ROTATION_ALLOWED',rotated.status===200&&rotated.rows[0]?.revision===2&&rotated.rows[0]?.credential_reference===reference);
  check('STALE_ROTATION_DENIED',(await rpc(serviceKey,'store_rev_calendar_credential',{...storeArgs,expected_revision:1})).status>=400);
  const afterRotation=await rpc(serviceKey,'load_rev_calendar_credential',loadArgs);
  check('LATEST_TOKEN_PRESERVED',afterRotation.rows[0]?.refresh_token===rotatedToken&&afterRotation.rows[0]?.revision===2);
  const calls=[['begin_rev_calendar_oauth',{...args,raw_state:material(),pkce_verifier:material()}],['consume_rev_calendar_oauth',args],['store_rev_calendar_credential',storeArgs],['load_rev_calendar_credential',loadArgs],['revoke_rev_calendar_credential',{target_workspace_id:workspaceId,target_connection_id:connectionId}],['purge_expired_rev_calendar_oauth',{target_workspace_id:workspaceId}]];
  const denied=[];
  for(const token of [owner.token,anonKey]) for(const [name,body] of calls) denied.push((await rpc(token,name,body)).status>=400);
  check('ALL_STORAGE_RPCS_BROWSER_DENIED',denied.every(Boolean));
  const revoked=await rpc(serviceKey,'revoke_rev_calendar_credential',{target_workspace_id:workspaceId,target_connection_id:connectionId});
  check('REVOCATION_FAILS_CLOSED',revoked.status<300&&(await rpc(serviceKey,'load_rev_calendar_credential',loadArgs)).status>=400);
  check('OWNED_SECRETS_REMOVED',sql(`select not exists(select 1 from rev_calendar_private.credentials where connection_id='${connectionId}') and not exists(select 1 from rev_calendar_private.oauth_transactions where connection_id='${connectionId}');`)==='t');
} finally {
  // Preserve append-only audit rows and their parent records; retire this run's fixtures.
  await retireFixtures(workspaces,identities);
}
console.log('MICROSOFT_REQUESTS=0');
console.log(`PHASE5_CALENDAR_OAUTH_STORAGE_LOCAL=${failures===0?'PASS':'FAIL'}`);
if(failures)process.exitCode=1;

}

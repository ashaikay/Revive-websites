import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const publicKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userId = 'd288c613-84f8-4530-b988-9984008427c4';
const stamp = `suspended-${Date.now()}`;

function userValue(name) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function urlFor(path, query = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function request(session, method, path, query = {}, body, prefer = 'return=representation') {
  const headers = { apikey: session.key ?? publicKey };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(urlFor(path, query), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { status: response.status, rows: Array.isArray(payload) ? payload : [], payload };
}

async function signIn() {
  const result = await request({ key: publicKey }, 'POST', '/auth/v1/token', { grant_type: 'password' }, { email: userValue('REV_RLS_USER_B_EMAIL'), password: userValue('REV_RLS_USER_B_PASSWORD') }, null);
  return { token: result.payload?.access_token, verified: result.status === 200 && result.payload?.user?.id === userId };
}

const publicSession = await signIn();
if (!publicSession.verified) throw new Error('User B authentication failed');

const workspaceResult = await request(publicSession, 'GET', '/rest/v1/workspaces', { select: 'id,name,created_by', name: 'eq.REV RLS Workspace B', created_by: `eq.${userId}` }, undefined, null);
if (workspaceResult.status !== 200 || workspaceResult.rows.length !== 1) throw new Error('Workspace B discovery was not unique');
const workspaceId = workspaceResult.rows[0].id;

const secretKey = userValue('SUPABASE_SECRET_KEY');
if (!secretKey) throw new Error('Admin setup credential unavailable');
const adminSession = { key: secretKey };
const membershipBefore = await request(adminSession, 'GET', '/rest/v1/workspace_members', { select: 'workspace_id,user_id,role,status', workspace_id: `eq.${workspaceId}`, user_id: `eq.${userId}` }, undefined, null);
if (membershipBefore.status !== 200 || membershipBefore.rows.length !== 1 || membershipBefore.rows[0].status !== 'active') throw new Error('Synthetic active membership precondition failed');
const original = membershipBefore.rows[0];

const suspend = await request(adminSession, 'PATCH', '/rest/v1/workspace_members', { workspace_id: `eq.${workspaceId}`, user_id: `eq.${userId}` }, { status: 'suspended' });
const suspended = suspend.status >= 200 && suspend.status < 300 && suspend.rows.length === 1 && suspend.rows[0].workspace_id === original.workspace_id && suspend.rows[0].user_id === original.user_id && suspend.rows[0].role === original.role && suspend.rows[0].status === 'suspended';
if (!suspended) throw new Error('Suspended membership setup failed');

const suspendedSession = await signIn();
if (!suspendedSession.verified) throw new Error('User B authentication after suspension failed');
const helper = await request(suspendedSession, 'POST', '/rest/v1/rpc/is_active_workspace_member', {}, { target_workspace_id: workspaceId });
const workspace = await request(suspendedSession, 'GET', '/rest/v1/workspaces', { select: 'id,created_by', id: `eq.${workspaceId}` }, undefined, null);
const tables = ['business_profiles', 'business_services', 'goals', 'contacts', 'rev_actions', 'approvals', 'business_memory_events', 'audit_log'];
const tenantResults = {};
for (const table of tables) tenantResults[table] = await request(suspendedSession, 'GET', `/rest/v1/${table}`, { select: 'workspace_id', workspace_id: `eq.${workspaceId}` }, undefined, null);
const helperDenied = helper.status === 200 && helper.payload === false;
const workspaceDenied = workspace.status === 200 && workspace.rows.length === 0;
const tenantDenied = tables.every((table) => tenantResults[table].status === 200 && tenantResults[table].rows.length === 0);
const marker = `REV suspended write ${stamp}`;
const write = await request(suspendedSession, 'POST', '/rest/v1/business_services', {}, { workspace_id: workspaceId, name: marker, description: 'suspended membership test' });
const markerRead = await request(suspendedSession, 'GET', '/rest/v1/business_services', { select: 'id,workspace_id', name: `eq.${marker}` }, undefined, null);
const writeDenied = markerRead.status === 200 && markerRead.rows.length === 0 && !(write.status >= 200 && write.status < 300 && write.rows.length > 0);
if (!(helperDenied && workspaceDenied && tenantDenied && writeDenied)) throw new Error('Suspended membership retained tenant access');

const restore = await request(adminSession, 'PATCH', '/rest/v1/workspace_members', { workspace_id: `eq.${workspaceId}`, user_id: `eq.${userId}` }, { status: 'active' });
const restored = restore.status >= 200 && restore.status < 300 && restore.rows.length === 1 && restore.rows[0].workspace_id === original.workspace_id && restore.rows[0].user_id === original.user_id && restore.rows[0].role === original.role && restore.rows[0].status === original.status;
if (!restored) throw new Error('Membership restoration failed');
const restoredSession = await signIn();
const restoredHelper = await request(restoredSession, 'POST', '/rest/v1/rpc/is_active_workspace_member', {}, { target_workspace_id: workspaceId });
const restoredWorkspace = await request(restoredSession, 'GET', '/rest/v1/workspaces', { select: 'id,created_by', id: `eq.${workspaceId}` }, undefined, null);
const restoredData = await request(restoredSession, 'GET', '/rest/v1/business_services', { select: 'workspace_id', workspace_id: `eq.${workspaceId}` }, undefined, null);
const restoredAccess = restoredSession.verified && restoredHelper.status === 200 && restoredHelper.payload === true && restoredWorkspace.status === 200 && restoredWorkspace.rows.length === 1 && restoredWorkspace.rows[0].id === workspaceId && restoredData.status === 200 && restoredData.rows.length > 0 && restoredData.rows.every((row) => row.workspace_id === workspaceId);
if (!restoredAccess) throw new Error('Restored User B access verification failed');

console.log('SUSPENDED MEMBERSHIP SETUP: PASS');
console.log('INACTIVE USER HELPER DENIED: PASS');
console.log('INACTIVE USER WORKSPACE READ DENIED: PASS');
console.log('INACTIVE USER TENANT DATA DENIED: PASS');
console.log('INACTIVE USER WRITE DENIED: PASS');
console.log('MEMBERSHIP RESTORED: PASS');
console.log('RESTORED USER ACCESS VERIFIED: PASS');

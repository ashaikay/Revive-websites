import { randomBytes } from 'node:crypto';

const baseUrl = 'http://127.0.0.1:55321';
const anonKey = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceRoleKey) throw new Error('Local Supabase test keys are required.');

let failures = 0;
function check(name, condition) {
  console.log(`${name}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures += 1;
}

async function request(token, method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, rows: Array.isArray(payload) ? payload : [], payload };
}

const rpc = (token, name, body) => request(token, 'POST', `/rest/v1/rpc/${name}`, body);

async function identity(label) {
  const stamp = `${Date.now()}-${label}`;
  const email = `phase5-calendar-${stamp}@example.test`;
  const password = `Local-${randomBytes(18).toString('base64url')}`;
  const created = await request(serviceRoleKey, 'POST', '/auth/v1/admin/users', {
    email,
    password,
    email_confirm: true,
  });
  const login = await request(anonKey, 'POST', '/auth/v1/token?grant_type=password', {
    email,
    password,
  });
  if (created.status !== 200 || login.status !== 200 || !login.payload?.access_token) {
    throw new Error(`Local identity failed: ${label}`);
  }
  return { id: created.payload.id, token: login.payload.access_token };
}

const owner = await identity('owner');
const admin = await identity('admin');
const member = await identity('member');
const suspendedAdmin = await identity('suspended-admin');
const outsider = await identity('outsider');
const stamp = Date.now();

const workspace = await rpc(owner.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 5 Calendar ${stamp}`,
  workspace_slug: `phase-5-calendar-${stamp}`,
});
const otherWorkspace = await rpc(outsider.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 5 Calendar Other ${stamp}`,
  workspace_slug: `phase-5-calendar-other-${stamp}`,
});
const workspaceId = workspace.payload?.[0]?.created_workspace_id;
const otherWorkspaceId = otherWorkspace.payload?.[0]?.created_workspace_id;
if (!workspaceId || !otherWorkspaceId) throw new Error('Local workspace setup failed.');

for (const [identityValue, role, status] of [
  [admin, 'admin', 'active'],
  [member, 'member', 'active'],
  [suspendedAdmin, 'admin', 'suspended'],
]) {
  const membership = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_members', {
    workspace_id: workspaceId,
    user_id: identityValue.id,
    role,
    status,
  });
  if (membership.status !== 201) throw new Error(`Local membership failed: ${role}/${status}`);
}

const connection = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendar_connections', {
  workspace_id: workspaceId,
  provider_key: 'microsoft_graph',
});
const otherConnection = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendar_connections', {
  workspace_id: otherWorkspaceId,
  provider_key: 'microsoft_graph',
});
const connectionId = connection.rows[0]?.id;
const otherConnectionId = otherConnection.rows[0]?.id;
check('CONNECTIONS_DEFAULT_DISCONNECTED',
  connection.status === 201 && otherConnection.status === 201
    && connection.rows[0]?.connection_status === 'disconnected'
    && connection.rows[0]?.credential_reference === null);

const primaryCalendar = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendars', {
  workspace_id: workspaceId,
  connection_id: connectionId,
  provider_calendar_reference: 'calendar-primary',
  display_name: 'Primary calendar',
  timezone: 'Europe/London',
  is_selected: true,
});
const otherCalendar = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendars', {
  workspace_id: otherWorkspaceId,
  connection_id: otherConnectionId,
  provider_calendar_reference: 'calendar-other',
  display_name: 'Other calendar',
  timezone: 'Europe/London',
  is_selected: true,
});
check('SERVICE_ROLE_SETUP_ALLOWED', primaryCalendar.status === 201 && otherCalendar.status === 201);

const safeColumns = 'id,workspace_id,provider_key,connection_status,provider_account_reference,authorized_by_user_id,authorized_at,revoked_at,last_verified_at,created_at,updated_at';
const ownerRead = await request(owner.token, 'GET', `/rest/v1/workspace_calendar_connections?select=${safeColumns}`);
const adminRead = await request(admin.token, 'GET', `/rest/v1/workspace_calendar_connections?select=${safeColumns}`);
const memberRead = await request(member.token, 'GET', `/rest/v1/workspace_calendar_connections?select=${safeColumns}`);
const suspendedRead = await request(suspendedAdmin.token, 'GET', `/rest/v1/workspace_calendar_connections?select=${safeColumns}`);
const otherOwnerRead = await request(outsider.token, 'GET', `/rest/v1/workspace_calendar_connections?select=${safeColumns}`);
check('OWNER_ADMIN_SANITIZED_READ_ALLOWED', ownerRead.rows.length === 1 && adminRead.rows.length === 1
  && ownerRead.rows[0]?.workspace_id === workspaceId && adminRead.rows[0]?.workspace_id === workspaceId);
check('CONNECTION_READ_TENANT_ISOLATION',ownerRead.rows[0]?.id!==otherConnectionId&&otherOwnerRead.rows.length===1
  &&otherOwnerRead.rows[0]?.id===otherConnectionId&&otherOwnerRead.rows[0]?.workspace_id===otherWorkspaceId);
check('MEMBER_SUSPENDED_READ_DENIED', memberRead.rows.length === 0 && suspendedRead.rows.length === 0);
check('CREDENTIAL_REFERENCE_READ_DENIED',
  (await request(owner.token, 'GET', '/rest/v1/workspace_calendar_connections?select=credential_reference')).status >= 400);

const ownerCalendars = await request(owner.token, 'GET', '/rest/v1/workspace_calendars?select=id,workspace_id,connection_id,is_selected,active');
const outsiderCalendars = await request(outsider.token, 'GET', '/rest/v1/workspace_calendars?select=id,workspace_id,connection_id,is_selected,active');
check('CALENDAR_TENANT_ISOLATION', ownerCalendars.rows.length === 1 && outsiderCalendars.rows.length === 1
  && ownerCalendars.rows[0]?.workspace_id === workspaceId
  && outsiderCalendars.rows[0]?.workspace_id === otherWorkspaceId);

const clientConnectionInsert = await request(owner.token, 'POST', '/rest/v1/workspace_calendar_connections', {
  workspace_id: workspaceId,
  provider_key: 'microsoft_graph',
});
const clientConnectionUpdate = await request(owner.token, 'PATCH',
  `/rest/v1/workspace_calendar_connections?id=eq.${connectionId}`, { connection_status: 'error' });
const clientCalendarInsert = await request(admin.token, 'POST', '/rest/v1/workspace_calendars', {
  workspace_id: workspaceId,
  connection_id: connectionId,
  provider_calendar_reference: 'forged-calendar',
  display_name: 'Forged calendar',
  timezone: 'Europe/London',
});
const clientCalendarDelete = await request(admin.token, 'DELETE',
  `/rest/v1/workspace_calendars?id=eq.${primaryCalendar.rows[0]?.id}`);
check('AUTHENTICATED_WRITES_DENIED', [
  clientConnectionInsert,
  clientConnectionUpdate,
  clientCalendarInsert,
  clientCalendarDelete,
].every((result) => result.status >= 400));

const crossWorkspaceCalendar = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendars', {
  workspace_id: workspaceId,
  connection_id: otherConnectionId,
  provider_calendar_reference: 'cross-workspace-calendar',
  display_name: 'Cross-workspace calendar',
  timezone: 'Europe/London',
});
check('WORKSPACE_SAFE_CONNECTION_FK', crossWorkspaceCalendar.status >= 400);

const duplicateSelection = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendars', {
  workspace_id: workspaceId,
  connection_id: connectionId,
  provider_calendar_reference: 'calendar-secondary',
  display_name: 'Secondary calendar',
  timezone: 'Europe/London',
  is_selected: true,
  active: true,
});
const unselectedCalendar = await request(serviceRoleKey, 'POST', '/rest/v1/workspace_calendars', {
  workspace_id: workspaceId,
  connection_id: connectionId,
  provider_calendar_reference: 'calendar-secondary',
  display_name: 'Secondary calendar',
  timezone: 'Europe/London',
  is_selected: false,
  active: true,
});
check('ONE_SELECTED_ACTIVE_CALENDAR_ENFORCED', duplicateSelection.status >= 400 && unselectedCalendar.status === 201);

console.log('OAUTH_REQUESTS=0');
console.log('PROVIDER_CALLS=0');
console.log(`PHASE5_CALENDAR_CONNECTIONS_LOCAL=${failures === 0 ? 'PASS' : 'FAIL'}`);
if (failures > 0) process.exitCode = 1;
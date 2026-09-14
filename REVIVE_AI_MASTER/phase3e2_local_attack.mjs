import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE_URL = 'http://127.0.0.1:55321';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// ---- helpers -------------------------------------------------------------
function randomPassword() {
  return 'Local-' + randomBytes(18).toString('base64url');
}

function url(path) {
  return new URL(path, BASE_URL);
}

async function adminCreateUser(email, password) {
  const res = await fetch(url('/auth/v1/admin/users'), {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, id: payload?.id };
}

async function adminSetMembershipStatus(workspaceId, userId, status) {
  const target = url('/rest/v1/workspace_members');
  target.searchParams.set('workspace_id', `eq.${workspaceId}`);
  target.searchParams.set('user_id', `eq.${userId}`);
  const res = await fetch(target, {
    method: 'PATCH',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ status }),
  });
  return res.status;
}

async function signIn(email, password) {
  const res = await fetch(url('/auth/v1/token?grant_type=password'), {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, token: payload?.access_token, userId: payload?.user?.id };
}

async function rest(token, method, path, query = {}, body) {
  const target = url(path);
  for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);
  const headers = { apikey: ANON_KEY, Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  headers['Prefer'] = 'return=representation';
  const res = await fetch(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await res.json(); } catch { /* no body */ }
  return { status: res.status, rows: Array.isArray(payload) ? payload : [], payload };
}

async function rpc(token, fn, args) {
  const res = await fetch(url(`/rest/v1/rpc/${fn}`), {
    method: 'POST',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

function ok(label, condition) {
  console.log(`${label}=${condition ? 'PASS' : 'FAIL'}`);
  return condition;
}

// ---- 1. create three local test identities --------------------------------
const stamp = Date.now();
const identities = {};
for (const label of ['A', 'B', 'C']) {
  const email = `local-user-${label.toLowerCase()}-${stamp}@example.test`;
  const password = randomPassword();
  const created = await adminCreateUser(email, password);
  identities[label] = { email, password, id: created.id };
}
console.log('USER_A_CREATED=' + Boolean(identities.A.id));
console.log('USER_B_CREATED=' + Boolean(identities.B.id));
console.log('USER_C_CREATED=' + Boolean(identities.C.id));

// ---- 2. sign each identity in through the normal public password grant ----
const sessions = {};
for (const label of ['A', 'B', 'C']) {
  sessions[label] = await signIn(identities[label].email, identities[label].password);
}
ok('SIGN_IN_A', sessions.A.status === 200 && sessions.A.userId === identities.A.id);
ok('SIGN_IN_B', sessions.B.status === 200 && sessions.B.userId === identities.B.id);
ok('SIGN_IN_C', sessions.C.status === 200 && sessions.C.userId === identities.C.id);

// ---- 3. User A and User B each bootstrap their own workspace (normal RPC, no secret) ----
const bootstrapA = await rpc(sessions.A.token, 'create_workspace_with_owner', { workspace_name: `Local Workspace A ${stamp}`, workspace_slug: `local-ws-a-${stamp}` });
const bootstrapB = await rpc(sessions.B.token, 'create_workspace_with_owner', { workspace_name: `Local Workspace B ${stamp}`, workspace_slug: `local-ws-b-${stamp}` });
const workspaceA = bootstrapA.payload?.[0]?.created_workspace_id;
const workspaceB = bootstrapB.payload?.[0]?.created_workspace_id;
ok('WORKSPACE_A_BOOTSTRAP', bootstrapA.status === 200 && Boolean(workspaceA));
ok('WORKSPACE_B_BOOTSTRAP', bootstrapB.status === 200 && Boolean(workspaceB));

// ---- 4. each owner creates one contact in their own workspace via normal REST insert ----
const contactAResult = await rest(sessions.A.token, 'POST', '/rest/v1/contacts', {}, {
  workspace_id: workspaceA, lifecycle: 'lead', name: 'Local Contact A', source: 'referral', estimated_value: 1000,
});
const contactBResult = await rest(sessions.B.token, 'POST', '/rest/v1/contacts', {}, {
  workspace_id: workspaceB, lifecycle: 'lead', name: 'Local Contact B', source: 'referral', estimated_value: 2000,
});
const contactA = contactAResult.rows?.[0]?.id;
const contactB = contactBResult.rows?.[0]?.id;
ok('CONTACT_A_CREATED', contactAResult.status === 201 && Boolean(contactA));
ok('CONTACT_B_CREATED', contactBResult.status === 201 && Boolean(contactB));

console.log('SETUP_JSON=' + JSON.stringify({ workspaceA, workspaceB, contactA, contactB, userA: identities.A.id, userB: identities.B.id, userC: identities.C.id }));

// ============================================================================
// 5. Own-tenant opportunity insert (User A, User B)
// ============================================================================
async function insertOpportunity(token, workspaceId, contactId, overrides = {}) {
  return rest(token, 'POST', '/rest/v1/opportunities', {}, {
    workspace_id: workspaceId,
    contact_id: contactId,
    title: 'Local test opportunity',
    opportunity_type: 'commercial_lead',
    stage: 'new',
    source: 'referral',
    estimated_value: 1000,
    currency: 'GBP',
    attribution: 'unattributed',
    created_by_type: 'user',
    ...overrides,
  });
}

const oppA1 = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'Opportunity A1' });
const oppA2 = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'Opportunity A2' });
const oppA3 = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'Opportunity A3' });
const oppB1 = await insertOpportunity(sessions.B.token, workspaceB, contactB, { title: 'Opportunity B1' });
ok('USER_A_INSERT_OWN_TENANT', oppA1.status === 201 && Boolean(oppA1.rows?.[0]?.id));
ok('USER_B_INSERT_OWN_TENANT', oppB1.status === 201 && Boolean(oppB1.rows?.[0]?.id));
ok('CONTACT_CARDINALITY_MULTIPLE_OPPORTUNITIES', [oppA1, oppA2, oppA3].every((r) => r.status === 201) && new Set([oppA1, oppA2, oppA3].map((r) => r.rows[0].id)).size === 3);

const opportunityAId = oppA1.rows[0].id;
const opportunityBId = oppB1.rows[0].id;

// ============================================================================
// 6. Own-tenant reads
// ============================================================================
const readOwnA = await rest(sessions.A.token, 'GET', '/rest/v1/opportunities', { select: 'id,workspace_id', workspace_id: `eq.${workspaceA}` });
const readOwnB = await rest(sessions.B.token, 'GET', '/rest/v1/opportunities', { select: 'id,workspace_id', workspace_id: `eq.${workspaceB}` });
ok('USER_A_READ_OWN_TENANT', readOwnA.status === 200 && readOwnA.rows.length === 3 && readOwnA.rows.every((r) => r.workspace_id === workspaceA));
ok('USER_B_READ_OWN_TENANT', readOwnB.status === 200 && readOwnB.rows.length === 1 && readOwnB.rows.every((r) => r.workspace_id === workspaceB));

// ============================================================================
// 7. Cross-tenant reads (User A -> Workspace B, User B -> Workspace A, User C -> both)
// ============================================================================
const aReadsB = await rest(sessions.A.token, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceB}` });
const bReadsA = await rest(sessions.B.token, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceA}` });
const cReadsA = await rest(sessions.C.token, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceA}` });
const cReadsB = await rest(sessions.C.token, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceB}` });
ok('USER_A_TO_B_READ_BLOCKED', aReadsB.status === 200 && aReadsB.rows.length === 0);
ok('USER_B_TO_A_READ_BLOCKED', bReadsA.status === 200 && bReadsA.rows.length === 0);
ok('USER_C_OUTSIDER_A_BLOCKED', cReadsA.status === 200 && cReadsA.rows.length === 0);
ok('USER_C_OUTSIDER_B_BLOCKED', cReadsB.status === 200 && cReadsB.rows.length === 0);

// ============================================================================
// 8. Cross-tenant contact injection (workspace_id=A, contact_id=B's contact)
// ============================================================================
const contactInjection = await insertOpportunity(sessions.A.token, workspaceA, contactB, { title: 'Injected opportunity' });
ok('CROSS_TENANT_CONTACT_INJECTION_BLOCKED', contactInjection.status >= 400 && contactInjection.rows.length === 0);

// ============================================================================
// 9. Workspace spoof attack (User A inserts claiming workspace_id = B)
// ============================================================================
const spoofByA = await insertOpportunity(sessions.A.token, workspaceB, contactB, { title: 'Spoofed by A' });
const spoofByB = await insertOpportunity(sessions.B.token, workspaceA, contactA, { title: 'Spoofed by B' });
ok('WORKSPACE_SPOOF_BY_A_BLOCKED', spoofByA.rows.length === 0);
ok('WORKSPACE_SPOOF_BY_B_BLOCKED', spoofByB.rows.length === 0);

// ============================================================================
// 10. Cross-workspace update attack: make User A a member of BOTH workspaces (fixture setup only,
// via a controlled admin path — mirrors the Phase 2D.1D suspended-membership setup precedent),
// then attempt to move an opportunity from A to B using A's own normal session.
// ============================================================================
const dualMembership = await fetch(url('/rest/v1/workspace_members'), {
  method: 'POST',
  headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({ workspace_id: workspaceB, user_id: identities.A.id, role: 'member', status: 'active' }),
});
ok('DUAL_MEMBERSHIP_FIXTURE_CREATED', dualMembership.status === 201);

const moveWorkspace = await rest(sessions.A.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` }, { workspace_id: workspaceB });
ok('CROSS_WORKSPACE_MOVE_BLOCKED', moveWorkspace.status >= 400 && moveWorkspace.rows.length === 0);

const moveContact = await rest(sessions.A.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` }, { contact_id: contactB });
ok('CONTACT_MUTATION_BLOCKED', moveContact.status >= 400 && moveContact.rows.length === 0);

const moveCreatedAt = await rest(sessions.A.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` }, { created_at: '2000-01-01T00:00:00Z' });
ok('CREATED_AT_MUTATION_BLOCKED', moveCreatedAt.status >= 400 && moveCreatedAt.rows.length === 0);

const moveCreatedByType = await rest(sessions.A.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` }, { created_by_type: 'system' });
ok('CREATED_BY_TYPE_MUTATION_BLOCKED', moveCreatedByType.status >= 400 && moveCreatedByType.rows.length === 0);

// A permitted mutable-field update should still succeed for comparison.
const permittedUpdate = await rest(sessions.A.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` }, { stage: 'qualified' });
ok('PERMITTED_FIELD_UPDATE_STILL_WORKS', permittedUpdate.status === 200 && permittedUpdate.rows?.[0]?.stage === 'qualified');

// ============================================================================
// 11. Delete attack (own-tenant and cross-tenant)
// ============================================================================
const deleteOwn = await rest(sessions.A.token, 'DELETE', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` });
const stillThereAfterOwnDelete = await rest(sessions.A.token, 'GET', '/rest/v1/opportunities', { select: 'id', id: `eq.${opportunityAId}` });
ok('DELETE_OWN_TENANT_DENIED', stillThereAfterOwnDelete.rows.length === 1);

const deleteCrossTenant = await rest(sessions.B.token, 'DELETE', '/rest/v1/opportunities', { id: `eq.${opportunityAId}` });
const stillThereAfterCrossDelete = await rest(sessions.A.token, 'GET', '/rest/v1/opportunities', { select: 'id', id: `eq.${opportunityAId}` });
ok('DELETE_CROSS_TENANT_DENIED', stillThereAfterCrossDelete.rows.length === 1);

console.log('DELETE_RESULT_STATUS_OWN=' + deleteOwn.status + ' CROSS=' + deleteCrossTenant.status);

// ============================================================================
// 12. Suspended membership test (own-tenant User B, using service role only for state prep)
// ============================================================================
const suspend = await adminSetMembershipStatus(workspaceB, identities.B.id, 'suspended');
ok('SUSPEND_FIXTURE_APPLIED', suspend === 200 || suspend === 204);

const suspendedSelect = await rest(sessions.B.token, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceB}` });
const suspendedInsert = await insertOpportunity(sessions.B.token, workspaceB, contactB, { title: 'Should be blocked while suspended' });
const suspendedUpdate = await rest(sessions.B.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${opportunityBId}` }, { stage: 'qualified' });
ok('SUSPENDED_SELECT_DENIED', suspendedSelect.status === 200 && suspendedSelect.rows.length === 0);
ok('SUSPENDED_INSERT_DENIED', suspendedInsert.rows.length === 0);
ok('SUSPENDED_UPDATE_DENIED', suspendedUpdate.rows.length === 0);

const restore = await adminSetMembershipStatus(workspaceB, identities.B.id, 'active');
ok('RESTORE_FIXTURE_APPLIED', restore === 200 || restore === 204);
const restoredSelect = await rest(sessions.B.token, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceB}` });
ok('ACCESS_RESTORED_AFTER_REACTIVATION', restoredSelect.status === 200 && restoredSelect.rows.length >= 1);

// ============================================================================
// 13. Stage / source / attribution constraint attacks
// ============================================================================
const invalidStage = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'bad stage', stage: 'winning_hard' });
const validStage = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'valid stage', stage: 'contacted' });
ok('INVALID_STAGE_REJECTED', invalidStage.status >= 400 && invalidStage.rows.length === 0);
ok('VALID_STAGE_ACCEPTED', validStage.status === 201 && validStage.rows.length === 1);

const invalidSource = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'bad source', source: 'carrier_pigeon' });
ok('INVALID_SOURCE_REJECTED', invalidSource.status >= 400 && invalidSource.rows.length === 0);

const invalidAttribution = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'bad attribution', attribution: 'rev_did_everything' });
ok('INVALID_ATTRIBUTION_REJECTED', invalidAttribution.status >= 400 && invalidAttribution.rows.length === 0);

// ============================================================================
// 14. Attribution never fabricates revenue merely by creation; only counted once WON
// ============================================================================
const newAttributed = await insertOpportunity(sessions.A.token, workspaceA, contactA, {
  title: 'rev generated candidate', stage: 'new', attribution: 'rev_generated', estimated_value: 9999,
});
ok('NEW_STAGE_REV_GENERATED_CREATED', newAttributed.status === 201);
const newAttributedId = newAttributed.rows?.[0]?.id;
// Application-level rule (computeOpportunityRevenue) only sums attribution for stage='won'; the
// database itself does not compute revenue, so this section documents the DB state a revenue
// calculation would read, not a DB-enforced accounting rule.
ok('REV_GENERATED_STAGE_IS_NEW_NOT_WON', newAttributed.rows?.[0]?.stage === 'new');
const wonTransition = await rest(sessions.A.token, 'PATCH', '/rest/v1/opportunities', { id: `eq.${newAttributedId}` }, { stage: 'won', won_at: new Date().toISOString() });
ok('TRANSITION_TO_WON_WITH_REV_GENERATED_ALLOWED', wonTransition.status === 200 && wonTransition.rows?.[0]?.stage === 'won');

// ============================================================================
// 15. Money / currency tests
// ============================================================================
const decimalValue = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'decimal', estimated_value: 1234.56 });
const zeroValue = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'zero', estimated_value: 0 });
const negativeValue = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'negative', estimated_value: -1 });
ok('DECIMAL_VALUE_ACCEPTED', decimalValue.status === 201);
ok('ZERO_VALUE_ACCEPTED', zeroValue.status === 201);
ok('NEGATIVE_VALUE_REJECTED', negativeValue.status >= 400 && negativeValue.rows.length === 0);

const gbp = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'gbp', currency: 'GBP' });
const usd = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'usd', currency: 'USD' });
const eur = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'eur', currency: 'EUR' });
const lowercase = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'lowercase', currency: 'gbp' });
const fourLetter = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'four', currency: 'GBPX' });
const twoLetter = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'two', currency: 'GB' });
ok('CURRENCY_GBP_ACCEPTED', gbp.status === 201);
ok('CURRENCY_USD_ACCEPTED', usd.status === 201);
ok('CURRENCY_EUR_ACCEPTED', eur.status === 201);
ok('CURRENCY_LOWERCASE_REJECTED', lowercase.status >= 400 && lowercase.rows.length === 0);
ok('CURRENCY_FOUR_LETTER_REJECTED', fourLetter.status >= 400 && fourLetter.rows.length === 0);
ok('CURRENCY_TWO_LETTER_REJECTED', twoLetter.status >= 400 && twoLetter.rows.length === 0);

// ============================================================================
// 16. Probability tests
// ============================================================================
const prob0 = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'p0', probability: 0 });
const prob05 = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'p0.5', probability: 0.5 });
const prob1 = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'p1', probability: 1 });
const probNeg = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'pNeg', probability: -0.01 });
const probOver = await insertOpportunity(sessions.A.token, workspaceA, contactA, { title: 'pOver', probability: 1.01 });
ok('PROBABILITY_0_ACCEPTED', prob0.status === 201);
ok('PROBABILITY_0_5_ACCEPTED', prob05.status === 201);
ok('PROBABILITY_1_ACCEPTED', prob1.status === 201);
ok('PROBABILITY_NEGATIVE_REJECTED', probNeg.status >= 400 && probNeg.rows.length === 0);
ok('PROBABILITY_OVER_1_REJECTED', probOver.status >= 400 && probOver.rows.length === 0);

// ============================================================================
// 17. Suppression isolation
// ============================================================================
const suppressA = await rest(sessions.A.token, 'POST', '/rest/v1/contact_suppressions', {}, {
  workspace_id: workspaceA, contact_id: contactA, reason: 'do_not_contact',
});
ok('SUPPRESSION_CREATED_OWN_TENANT', suppressA.status === 201);
const bReadsASuppressions = await rest(sessions.B.token, 'GET', '/rest/v1/contact_suppressions', { select: 'contact_id', workspace_id: `eq.${workspaceA}` });
ok('SUPPRESSION_ISOLATED_FROM_OTHER_WORKSPACE', bReadsASuppressions.status === 200 && bReadsASuppressions.rows.length === 0);
const bDeletesASuppression = await rest(sessions.B.token, 'DELETE', '/rest/v1/contact_suppressions', { workspace_id: `eq.${workspaceA}`, contact_id: `eq.${contactA}` });
const suppressionStillThere = await rest(sessions.A.token, 'GET', '/rest/v1/contact_suppressions', { select: 'contact_id', workspace_id: `eq.${workspaceA}` });
ok('CROSS_TENANT_SUPPRESSION_DELETE_BLOCKED', suppressionStillThere.rows.length === 1);

// ============================================================================
// 18. Opportunity -> REV action tenant integrity
// ============================================================================
const crossActionLink = await rest(sessions.A.token, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceA,
  contact_id: contactA,
  opportunity_id: opportunityBId, // belongs to workspace B
  action_type: 'outreach',
  title: 'cross-tenant action link attempt',
  description: 'attack test',
  requires_approval: true,
});
ok('REV_ACTION_TO_FOREIGN_OPPORTUNITY_BLOCKED', crossActionLink.status >= 400 && crossActionLink.rows.length === 0);

const validActionLink = await rest(sessions.A.token, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceA,
  contact_id: contactA,
  opportunity_id: opportunityAId,
  action_type: 'outreach',
  title: 'valid same-tenant action link',
  description: 'valid test',
  requires_approval: true,
});
ok('REV_ACTION_TO_OWN_OPPORTUNITY_ALLOWED', validActionLink.status === 201);

console.log('ATTACK_MATRIX_COMPLETE=TRUE');



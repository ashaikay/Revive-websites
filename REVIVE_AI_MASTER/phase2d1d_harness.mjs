import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const publicKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userIds = {
  A: '8b2c373e-73ce-4c35-b1aa-875a5d441bb4',
  B: 'd288c613-84f8-4530-b988-9984008427c4',
  C: 'be0b5874-4264-4f36-869b-f16ab689c33b',
};

function getUserValue(name) {
  const script = `[Environment]::GetEnvironmentVariable('${name}', 'User')`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function requestUrl(path, query = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function request(session, method, path, query = {}, body) {
  const url = requestUrl(path, query);
  const expectedFilter = query.id;
  if (expectedFilter !== undefined && url.searchParams.get('id') !== expectedFilter) {
    throw new Error('HARNESS URL ASSERTION FAILURE');
  }
  const headers = {
    apikey: publicKey,
    Authorization: `Bearer ${session.token}`,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  return { status: response.status, rows: Array.isArray(payload) ? payload : [], payload };
}

async function signIn(label) {
  const email = getUserValue(`REV_RLS_USER_${label}_EMAIL`);
  const password = getUserValue(`REV_RLS_USER_${label}_PASSWORD`);
  const response = await request({ token: publicKey }, 'POST', '/auth/v1/token', { grant_type: 'password' }, { email, password });
  const user = response.payload?.user;
  return {
    token: response.payload?.access_token,
    verified: response.status === 200 && Boolean(response.payload?.access_token) && user?.id === userIds[label],
  };
}

function exactWorkspace(session, workspaceId) {
  return request(session, 'GET', '/rest/v1/workspaces', {
    select: 'id,created_by',
    id: `eq.${workspaceId}`,
  });
}

function exactMembership(session, workspaceId) {
  return request(session, 'GET', '/rest/v1/workspace_members', {
    select: 'workspace_id,user_id,role,status',
    workspace_id: `eq.${workspaceId}`,
  });
}

function helper(session, workspaceId) {
  return request(session, 'POST', '/rest/v1/rpc/is_active_workspace_member', {}, {
    target_workspace_id: workspaceId,
  });
}

function rowCount(result) {
  return result.status === 200 ? result.rows.length : -1;
}

function oneWorkspace(result, workspaceId, creatorId) {
  return result.status === 200 && result.rows.length === 1 && result.rows[0].id === workspaceId && result.rows[0].created_by === creatorId;
}

function empty(result) {
  return result.status === 200 && result.rows.length === 0;
}

function oneMembership(result, workspaceId, userId) {
  return result.status === 200 && result.rows.length === 1 && result.rows[0].workspace_id === workspaceId && result.rows[0].user_id === userId;
}

function helperValue(result) {
  return result.status === 200 && result.payload === true;
}

async function runOnce() {
  const sessions = {
    A: await signIn('A'),
    B: await signIn('B'),
    C: await signIn('C'),
  };
  if (!sessions.A.verified || !sessions.B.verified || !sessions.C.verified) {
    return { authA: sessions.A.verified, authB: sessions.B.verified, authC: sessions.C.verified, pass: false };
  }

  const discoveredA = await request(sessions.A, 'GET', '/rest/v1/workspaces', {
    select: 'id,name,created_by',
    name: 'eq.REV RLS Workspace A',
    created_by: `eq.${userIds.A}`,
  });
  const discoveredB = await request(sessions.B, 'GET', '/rest/v1/workspaces', {
    select: 'id,name,created_by',
    name: 'eq.REV RLS Workspace B',
    created_by: `eq.${userIds.B}`,
  });
  const workspaceA = discoveredA.rows.length === 1 ? discoveredA.rows[0].id : null;
  const workspaceB = discoveredB.rows.length === 1 ? discoveredB.rows[0].id : null;
  const workspaceAUnique = discoveredA.status === 200 && discoveredA.rows.length === 1;
  const workspaceBUnique = discoveredB.status === 200 && discoveredB.rows.length === 1;
  const creatorsVerified = workspaceAUnique && workspaceBUnique && discoveredA.rows[0].created_by === userIds.A && discoveredB.rows[0].created_by === userIds.B;
  const idsDifferent = workspaceAUnique && workspaceBUnique && workspaceA !== workspaceB;
  if (!workspaceA || !workspaceB) return { ...sessions, workspaceAUnique, workspaceBUnique, idsDifferent, creatorsVerified, pass: false };

  const checks = {
    aa: await exactWorkspace(sessions.A, workspaceA),
    ab: await exactWorkspace(sessions.A, workspaceB),
    bb: await exactWorkspace(sessions.B, workspaceB),
    ba: await exactWorkspace(sessions.B, workspaceA),
    ca: await exactWorkspace(sessions.C, workspaceA),
    cb: await exactWorkspace(sessions.C, workspaceB),
    ma: await exactMembership(sessions.A, workspaceA),
    mb: await exactMembership(sessions.A, workspaceB),
    nb: await exactMembership(sessions.B, workspaceB),
    na: await exactMembership(sessions.B, workspaceA),
    caMembership: await exactMembership(sessions.C, workspaceA),
    cbMembership: await exactMembership(sessions.C, workspaceB),
    helperAA: await helper(sessions.A, workspaceA),
    helperAB: await helper(sessions.A, workspaceB),
    helperBB: await helper(sessions.B, workspaceB),
    helperBA: await helper(sessions.B, workspaceA),
    helperCA: await helper(sessions.C, workspaceA),
    helperCB: await helper(sessions.C, workspaceB),
  };

  const servicesA = await request(sessions.A, 'GET', '/rest/v1/business_services', { select: 'id,workspace_id' });
  const servicesB = await request(sessions.B, 'GET', '/rest/v1/business_services', { select: 'id,workspace_id' });
  const serviceA = servicesA.rows.find((row) => row.workspace_id === workspaceA);
  const serviceB = servicesB.rows.find((row) => row.workspace_id === workspaceB);
  const data = {
    aa: serviceA ? await request(sessions.A, 'GET', '/rest/v1/business_services', { select: 'workspace_id', id: `eq.${serviceA.id}` }) : null,
    ab: serviceB ? await request(sessions.A, 'GET', '/rest/v1/business_services', { select: 'workspace_id', id: `eq.${serviceB.id}` }) : null,
    bb: serviceB ? await request(sessions.B, 'GET', '/rest/v1/business_services', { select: 'workspace_id', id: `eq.${serviceB.id}` }) : null,
    ba: serviceA ? await request(sessions.B, 'GET', '/rest/v1/business_services', { select: 'workspace_id', id: `eq.${serviceA.id}` }) : null,
    ca: serviceA ? await request(sessions.C, 'GET', '/rest/v1/business_services', { select: 'workspace_id', id: `eq.${serviceA.id}` }) : null,
    cb: serviceB ? await request(sessions.C, 'GET', '/rest/v1/business_services', { select: 'workspace_id', id: `eq.${serviceB.id}` }) : null,
  };
  const dataReady = Object.values(data).every(Boolean);
  const dataPass = dataReady && rowCount(data.aa) === 1 && data.aa.rows[0].workspace_id === workspaceA && empty(data.ab) && rowCount(data.bb) === 1 && data.bb.rows[0].workspace_id === workspaceB && empty(data.ba) && empty(data.ca) && empty(data.cb);
  const helperPass = helperValue(checks.helperAA) && !helperValue(checks.helperAB) && helperValue(checks.helperBB) && !helperValue(checks.helperBA) && !helperValue(checks.helperCA) && !helperValue(checks.helperCB);
  const workspaceAExact = oneWorkspace(checks.aa, workspaceA, userIds.A);
  const workspaceBExact = oneWorkspace(checks.bb, workspaceB, userIds.B);
  const workspacePass = workspaceAExact && empty(checks.ab) && workspaceBExact && empty(checks.ba) && empty(checks.ca) && empty(checks.cb);
  const membershipPass = oneMembership(checks.ma, workspaceA, userIds.A) && empty(checks.mb) && oneMembership(checks.nb, workspaceB, userIds.B) && empty(checks.na) && empty(checks.caMembership) && empty(checks.cbMembership);

  return {
    authA: true,
    authB: true,
    authC: true,
    workspaceAUnique,
    workspaceBUnique,
    idsDifferent,
    creatorsVerified,
    workspacePass,
    membershipPass,
    helperPass,
    dataPass,
    workspaceAExact,
    workspaceBExact,
    counts: { ab: rowCount(checks.ab), ba: rowCount(checks.ba), ca: rowCount(checks.ca), cb: rowCount(checks.cb), mb: rowCount(checks.mb), na: rowCount(checks.na), caMembership: rowCount(checks.caMembership), cbMembership: rowCount(checks.cbMembership) },
    pass: workspacePass && membershipPass && helperPass && dataPass && workspaceAUnique && workspaceBUnique && idsDifferent && creatorsVerified,
  };
}

const runs = [];
for (let index = 0; index < 3; index += 1) runs.push(await runOnce());
function assertionSignature(run) {
  return JSON.stringify({
    authA: run.authA,
    authB: run.authB,
    authC: run.authC,
    workspaceAUnique: run.workspaceAUnique,
    workspaceBUnique: run.workspaceBUnique,
    idsDifferent: run.idsDifferent,
    creatorsVerified: run.creatorsVerified,
    workspaceAExact: run.workspaceAExact,
    workspaceBExact: run.workspaceBExact,
    workspacePass: run.workspacePass,
    membershipPass: run.membershipPass,
    helperPass: run.helperPass,
    dataPass: run.dataPass,
    counts: run.counts,
    pass: run.pass,
  });
}
const comparable = runs.every((run) => assertionSignature(run) === assertionSignature(runs[0]));
const result = runs[0];
console.log(`NODE HARNESS CREATED: TRUE`);
console.log(`AUTH A: ${result.authA ? 'TRUE' : 'FALSE'}`);
console.log(`AUTH B: ${result.authB ? 'TRUE' : 'FALSE'}`);
console.log(`AUTH C: ${result.authC ? 'TRUE' : 'FALSE'}`);
console.log(`WORKSPACE A UNIQUE: ${result.workspaceAUnique ? 'TRUE' : 'FALSE'}`);
console.log(`WORKSPACE B UNIQUE: ${result.workspaceBUnique ? 'TRUE' : 'FALSE'}`);
console.log(`WORKSPACE IDS DIFFERENT: ${result.idsDifferent ? 'TRUE' : 'FALSE'}`);
console.log(`CREATORS VERIFIED: ${result.creatorsVerified ? 'TRUE' : 'FALSE'}`);
console.log(`A -> A WORKSPACE: ${result.workspaceAExact ? 'TRUE' : 'FALSE'}`);
console.log(`A -> B WORKSPACE ROWS: ${result.counts?.ab ?? -1}`);
console.log(`B -> B WORKSPACE: ${result.workspaceBExact ? 'TRUE' : 'FALSE'}`);
console.log(`B -> A WORKSPACE ROWS: ${result.counts?.ba ?? -1}`);
console.log(`C -> A WORKSPACE ROWS: ${result.counts?.ca ?? -1}`);
console.log(`C -> B WORKSPACE ROWS: ${result.counts?.cb ?? -1}`);
console.log(`A -> A MEMBERSHIP: ${result.membershipPass ? 'TRUE' : 'FALSE'}`);
console.log(`A -> B MEMBERSHIP ROWS: ${result.counts?.mb ?? -1}`);
console.log(`B -> B MEMBERSHIP: ${result.membershipPass ? 'TRUE' : 'FALSE'}`);
console.log(`B -> A MEMBERSHIP ROWS: ${result.counts?.na ?? -1}`);
console.log(`C -> A MEMBERSHIP ROWS: ${result.counts?.caMembership ?? -1}`);
console.log(`C -> B MEMBERSHIP ROWS: ${result.counts?.cbMembership ?? -1}`);
console.log(`HELPER CROSS-CHECK: ${result.helperPass ? 'PASS' : 'FAIL'}`);
console.log(`REPRESENTATIVE TENANT DATA ISOLATION: ${result.dataPass ? 'PASS' : 'FAIL'}`);
for (let index = 0; index < runs.length; index += 1) console.log(`RUN ${index + 1}: ${runs[index].pass ? 'PASS' : 'FAIL'}`);
console.log(`RESULTS IDENTICAL: ${comparable ? 'TRUE' : 'FALSE'}`);
console.log('POWERSHELL HARNESS MARKED UNRELIABLE: TRUE');
console.log('REPORT UPDATED: PENDING');
console.log(`HARNESS RESULT: ${result.pass && comparable ? 'PASS' : 'FAIL'}`);
console.log(`READY TO RESUME ATTACK MATRIX: ${result.pass && comparable ? 'TRUE' : 'FALSE'}`);

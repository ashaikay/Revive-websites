import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const anonKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userBId = 'd288c613-84f8-4530-b988-9984008427c4';
const expectedEmail = 'natalie_atkins2000@yahoo.co.uk';

function getProcEnv(name) {
  return process.env[name] ?? '';
}

function getUserScopeValue(name) {
  const script = `[Environment]::GetEnvironmentVariable('${name}', 'User')`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function credential(name) {
  const proc = getProcEnv(name);
  if (proc) return proc;
  return getUserScopeValue(name);
}

const secretKey = credential('SUPABASE_SECRET_KEY');
const userEmail = credential('REV_RLS_USER_B_EMAIL');
const userPassword = credential('REV_RLS_USER_B_PASSWORD');

const report = {};

async function adminGetUser() {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userBId}`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

async function passwordSignIn(email, password) {
  const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

async function adminSetPassword(newPassword) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userBId}`, {
    method: 'PUT',
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword }),
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

async function selfMembershipCheck(token) {
  const url = new URL('/rest/v1/workspace_members', baseUrl);
  url.searchParams.set('select', 'workspace_id,user_id,role,status');
  url.searchParams.set('user_id', `eq.${userBId}`);
  const res = await fetch(url, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  const payload = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(payload) ? payload : [] };
}

// Step 1: admin inspection (secret key used only to inspect the Auth account)
const admin = await adminGetUser();
report.accountExists = admin.status === 200 && Boolean(admin.payload?.id);
report.uuidMatch = report.accountExists && admin.payload.id === userBId;
report.emailOnFile = admin.payload?.email ?? null;
report.emailMatchesExpected = (report.emailOnFile ?? '').toLowerCase() === expectedEmail.toLowerCase();
report.emailConfirmed = Boolean(admin.payload?.email_confirmed_at || admin.payload?.confirmed_at);
report.banned = Boolean(admin.payload?.banned_until);
const identities = Array.isArray(admin.payload?.identities) ? admin.payload.identities : [];
report.providers = identities.map((identity) => identity.provider);
report.hasEmailProvider = report.providers.includes('email');

// Step 2: attempt normal password sign-in with the existing stored credential
const firstAttempt = await passwordSignIn(userEmail, userPassword);
report.initialSignInStatus = firstAttempt.status;
report.initialSignInError = firstAttempt.payload?.error_code ?? firstAttempt.payload?.error ?? firstAttempt.payload?.msg ?? null;
report.initialSignInVerified = firstAttempt.status === 200 && firstAttempt.payload?.user?.id === userBId;

let resetPerformed = false;
let finalVerified = report.initialSignInVerified;
let finalToken = firstAttempt.payload?.access_token ?? null;

// Step 3: only if normal sign-in failed and the account exists/is enabled, set a new temporary password.
// The temp password value must already be present in the calling terminal's REV_USERB_TEMP_PASSWORD
// process environment variable (generated locally); this script never invents or prints it.
if (!report.initialSignInVerified && report.accountExists && !report.banned) {
  const tempPassword = getProcEnv('REV_USERB_TEMP_PASSWORD');
  if (!tempPassword) {
    report.resetSkippedReason = 'REV_USERB_TEMP_PASSWORD not set in process environment';
  } else {
    const setResult = await adminSetPassword(tempPassword);
    resetPerformed = setResult.status === 200;
    if (resetPerformed) {
      const retry = await passwordSignIn(userEmail, tempPassword);
      finalVerified = retry.status === 200 && retry.payload?.user?.id === userBId;
      finalToken = retry.payload?.access_token ?? null;
      report.postResetSignInStatus = retry.status;
    }
  }
}

// Step 4: use the resulting normal public-client session (not the secret key) for the tenant membership check
let membershipMatch = null;
if (finalVerified && finalToken) {
  const membership = await selfMembershipCheck(finalToken);
  membershipMatch = membership.status === 200 && membership.rows.some((row) => row.user_id === userBId);
  report.membershipRowCount = membership.rows.length;
}

console.log('ACCOUNT_EXISTS=' + report.accountExists);
console.log('UUID_MATCH=' + report.uuidMatch);
console.log('EMAIL_MATCHES_EXPECTED=' + report.emailMatchesExpected);
console.log('EMAIL_CONFIRMED=' + report.emailConfirmed);
console.log('BANNED=' + report.banned);
console.log('PROVIDERS=' + report.providers.join(','));
console.log('INITIAL_SIGNIN_STATUS=' + report.initialSignInStatus);
console.log('INITIAL_SIGNIN_ERROR=' + report.initialSignInError);
console.log('INITIAL_SIGNIN_VERIFIED=' + report.initialSignInVerified);
console.log('RESET_PERFORMED=' + resetPerformed);
console.log('POST_RESET_SIGNIN_STATUS=' + (report.postResetSignInStatus ?? 'n/a'));
console.log('FINAL_SIGNIN_VERIFIED=' + finalVerified);
console.log('MEMBERSHIP_MATCH=' + membershipMatch);
console.log('MEMBERSHIP_ROW_COUNT=' + (report.membershipRowCount ?? 'n/a'));
console.log('TEMP_PASSWORD_STORED_IN_PROCESS_ENV_ONLY=' + resetPerformed);

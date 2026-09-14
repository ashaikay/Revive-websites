import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const anonKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userCId = 'be0b5874-4264-4f36-869b-f16ab689c33b';
const userCEmail = 'wellnessatworkforyou@gmail.com';

function getUserScopeValue(name) {
  const script = `[Environment]::GetEnvironmentVariable('${name}', 'User')`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function credential(name) {
  return process.env[name] || getUserScopeValue(name);
}

const secretKey = credential('SUPABASE_SECRET_KEY');
const tempPassword = process.env.REV_USERC_TEMP_PASSWORD;

if (!tempPassword) {
  console.log('RESET_ABORTED=REV_USERC_TEMP_PASSWORD_NOT_SET');
  process.exit(1);
}

async function adminGetUser() {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userCId}`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
  });
  const payload = await res.json().catch(() => null);
  return { status: res.status, payload };
}

async function adminSetPassword(newPassword) {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userCId}`, {
    method: 'PUT',
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: newPassword }),
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

async function selfMembershipCheck(token) {
  const url = new URL('/rest/v1/workspace_members', baseUrl);
  url.searchParams.set('select', 'workspace_id,user_id,role,status');
  url.searchParams.set('user_id', `eq.${userCId}`);
  const res = await fetch(url, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  const payload = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(payload) ? payload : [] };
}

const before = await adminGetUser();
const accountExists = before.status === 200 && Boolean(before.payload?.id);
const uuidMatch = accountExists && before.payload.id === userCId;
const emailMatch = (before.payload?.email ?? '').toLowerCase() === userCEmail.toLowerCase();
const emailConfirmed = Boolean(before.payload?.email_confirmed_at || before.payload?.confirmed_at);
const banned = Boolean(before.payload?.banned_until);

const reset = await adminSetPassword(tempPassword);
const resetOk = reset.status === 200 && reset.payload?.id === userCId;

const signIn = await passwordSignIn(userCEmail, tempPassword);
const signInOk = signIn.status === 200 && signIn.payload?.user?.id === userCId;
const token = signIn.payload?.access_token ?? null;

let membershipRowCount = null;
if (signInOk && token) {
  const membership = await selfMembershipCheck(token);
  membershipRowCount = membership.status === 200 ? membership.rows.length : -1;
}

console.log('ACCOUNT_EXISTS=' + accountExists);
console.log('UUID_MATCH=' + uuidMatch);
console.log('EMAIL_MATCH=' + emailMatch);
console.log('EMAIL_CONFIRMED=' + emailConfirmed);
console.log('BANNED=' + banned);
console.log('RESET_STATUS=' + reset.status);
console.log('RESET_OK=' + resetOk);
console.log('NORMAL_PUBLIC_SIGNIN_OK=' + signInOk);
console.log('MEMBERSHIP_ROW_COUNT=' + membershipRowCount);

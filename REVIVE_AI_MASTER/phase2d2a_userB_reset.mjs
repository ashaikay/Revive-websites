import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const anonKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userBId = 'd288c613-84f8-4530-b988-9984008427c4';
const userBEmail = 'natalie_atkins2000@yahoo.co.uk';

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
const tempPassword = process.env.REV_USERB_TEMP_PASSWORD;

if (!tempPassword) {
  console.log('RESET_ABORTED=REV_USERB_TEMP_PASSWORD_NOT_SET');
  process.exit(1);
}

async function adminGetUser() {
  const res = await fetch(`${baseUrl}/auth/v1/admin/users/${userBId}`, {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
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
  url.searchParams.set('user_id', `eq.${userBId}`);
  const res = await fetch(url, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  const payload = await res.json().catch(() => null);
  return { status: res.status, rows: Array.isArray(payload) ? payload : [] };
}

const before = await adminGetUser();
const uuidBefore = before.payload?.id === userBId;
const emailBefore = (before.payload?.email ?? '').toLowerCase() === userBEmail.toLowerCase();

const reset = await adminSetPassword(tempPassword);
const resetOk = reset.status === 200 && reset.payload?.id === userBId;

const after = await adminGetUser();
const uuidAfter = after.payload?.id === userBId;
const emailAfter = (after.payload?.email ?? '').toLowerCase() === userBEmail.toLowerCase();

const signIn = await passwordSignIn(userBEmail, tempPassword);
const signInOk = signIn.status === 200 && signIn.payload?.user?.id === userBId;
const token = signIn.payload?.access_token ?? null;

let membershipOk = null;
if (signInOk && token) {
  const membership = await selfMembershipCheck(token);
  membershipOk = membership.status === 200 && membership.rows.length === 1 && membership.rows[0].user_id === userBId;
}

console.log('RESET_STATUS=' + reset.status);
console.log('RESET_OK=' + resetOk);
console.log('UUID_PRESERVED=' + (uuidBefore && uuidAfter));
console.log('EMAIL_PRESERVED=' + (emailBefore && emailAfter));
console.log('NORMAL_PUBLIC_SIGNIN_OK=' + signInOk);
console.log('MEMBERSHIP_PRESERVED=' + membershipOk);

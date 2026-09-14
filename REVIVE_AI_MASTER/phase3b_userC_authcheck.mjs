import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const anonKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userCId = 'be0b5874-4264-4f36-869b-f16ab689c33b';

function getUserScopeValue(name) {
  const script = `[Environment]::GetEnvironmentVariable('${name}', 'User')`;
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

const email = getUserScopeValue('REV_RLS_USER_C_EMAIL') || 'wellnessatworkforyou@gmail.com';
const password = getUserScopeValue('REV_RLS_USER_C_PASSWORD');

const res = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anonKey, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const payload = await res.json().catch(() => null);

console.log('BASE_URL=' + baseUrl);
console.log('STATUS=' + res.status);
console.log('USER_ID_MATCH=' + (payload?.user?.id === userCId));
console.log('HAS_ACCESS_TOKEN=' + Boolean(payload?.access_token));
console.log('ERROR_CODE=' + (payload?.error_code ?? payload?.error ?? 'none'));

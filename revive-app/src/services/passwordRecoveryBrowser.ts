// Capture credentials before the Supabase client starts. Never persist callback credentials.
export type RecoveryEntry = { active: boolean; invitationId: string | null; credentials: { access_token: string; refresh_token: string } | { code: string } | null };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function recoveryUrl(location: Pick<Location, 'href'>, invitationId?: string | null) {
  const url = new URL(location.href);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Secure REV address required.');
  url.search = ''; url.hash = ''; url.searchParams.set('rev_auth_recovery', '1');
  if (invitationId && uuid.test(invitationId)) url.searchParams.set('rev_team_invite', invitationId);
  return url;
}
export function captureRecovery(href: string, replace: (url: string) => void): RecoveryEntry {
  const url = new URL(href), hash = new URLSearchParams(url.hash.slice(1));
  if (url.pathname === '/calendar/outlook/callback' || !(url.searchParams.has('rev_auth_recovery') || hash.get('type') === 'recovery')) return { active: false, invitationId: null, credentials: null };
  const ids = url.searchParams.getAll('rev_team_invite');
  const invitationId = ids.length === 1 && uuid.test(ids[0]) ? ids[0] : null;
  const one = (params: URLSearchParams, key: string) => params.getAll(key).length === 1 ? params.get(key) : null;
  const access = one(hash, 'access_token'), refresh = one(hash, 'refresh_token'), code = one(url.searchParams, 'code');
  const hasError = [...url.searchParams.keys(), ...hash.keys()].some(key => key.startsWith('error'));
  let credentials: RecoveryEntry['credentials'] = null;
  if (!hasError && !code && hash.get('type') === 'recovery' && access && refresh && access.length < 16384 && refresh.length < 4096) credentials = { access_token: access, refresh_token: refresh };
  else if (!hasError && code && code.length < 4096 && !access && !refresh && url.searchParams.getAll('rev_auth_recovery').length === 1) credentials = { code };
  const clean = recoveryUrl(url, invitationId);
  replace(clean.pathname + clean.search);
  return { active: true, invitationId, credentials };
}
export const passwordRecoveryEntry = typeof window === 'undefined' ? { active: false, invitationId: null, credentials: null } as RecoveryEntry : captureRecovery(window.location.href, url => window.history.replaceState(null, '', url));

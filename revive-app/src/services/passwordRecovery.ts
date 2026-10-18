import { supabaseClient } from '@/data/supabaseClient';
import { passwordRecoveryEntry, recoveryUrl } from './passwordRecoveryBrowser';
let verification: Promise<{ id: string; email: string }> | null = null;
// Module-level promise prevents React StrictMode from consuming a one-use code twice.
export function verifyRecovery() {
  if (!verification) verification = (async () => {
    const credentials = passwordRecoveryEntry.credentials;
    passwordRecoveryEntry.credentials = null;
    if (!supabaseClient || !credentials) throw new Error('This password link is unavailable or has expired. Request a new link below.');
    const result = 'code' in credentials ? await supabaseClient.auth.exchangeCodeForSession(credentials.code) : await supabaseClient.auth.setSession(credentials);
    if (result.error || !result.data.session) throw new Error('This password link is unavailable or has expired. Request a new link below.');
    const checked = await supabaseClient.auth.getUser();
    if (checked.error || !checked.data.user || checked.data.user.id !== result.data.session.user.id) throw new Error('Your account could not be verified. Request a new password link.');
    return { id: checked.data.user.id, email: checked.data.user.email ?? '' };
  })();
  return verification;
}
export async function requestPassword(email: string, invitationId?: string | null) {
  if (!supabaseClient) throw new Error('Password setup is unavailable.');
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryUrl(window.location, invitationId).href });
  if (error) throw new Error('The email request could not be completed. Please wait and try again.');
}
export function passwordProblem(password: string, confirmation: string) {
  if (password.length < 12 || new TextEncoder().encode(password).length > 72) return 'Use at least 12 characters and no more than 72 bytes.';
  if (password !== confirmation) return 'The passwords do not match.';
  return '';
}
export async function saveRecoveryPassword(userId: string, password: string) {
  if (!supabaseClient) throw new Error('Password setup is unavailable.');
  const checked = await supabaseClient.auth.getUser();
  if (checked.error || checked.data.user?.id !== userId) throw new Error('Your session changed or expired. Request a new password link.');
  const { data, error } = await supabaseClient.auth.updateUser({ password });
  if (error || data.user?.id !== userId) throw new Error('Password change not confirmed. Try signing in with your new password before requesting another link.');
}

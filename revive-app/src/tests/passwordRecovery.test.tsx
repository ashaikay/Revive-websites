// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { setSession: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), resetPasswordForEmail: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: { auth: mocks.auth } }));
const id = '44444444-4444-4444-8444-444444444444';
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
  mocks.auth.getUser.mockResolvedValue({ data: { user: { id, email: 'staff@example.test' } }, error: null });
  mocks.auth.setSession.mockResolvedValue({ data: { session: { user: { id } } }, error: null });
  mocks.auth.exchangeCodeForSession.mockResolvedValue({ data: { session: { user: { id } } }, error: null });
  mocks.auth.updateUser.mockResolvedValue({ data: { user: { id } }, error: null });
  mocks.auth.signOut.mockResolvedValue({ error: null });
  mocks.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  mocks.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});
afterEach(cleanup);
it('scrubs credentials and retains only the validated invitation', async () => {
  const { captureRecovery } = await import('@/services/passwordRecoveryBrowser');
  const replace = vi.fn();
  const entry = captureRecovery('https://rev11.netlify.app/?rev_auth_recovery=1&rev_team_invite='+id+'#type=recovery&access_token=secret&refresh_token=private', replace);
  expect(entry.credentials).toEqual({ access_token: 'secret', refresh_token: 'private' });
  expect(replace).toHaveBeenCalledWith('/?rev_auth_recovery=1&rev_team_invite='+id);
});
it('leaves calendar callbacks alone and rejects errors, duplicate credentials and incomplete links', async () => {
  const { captureRecovery } = await import('@/services/passwordRecoveryBrowser');
  const replace = vi.fn();
  expect(captureRecovery('https://rev11.netlify.app/calendar/outlook/callback?rev_auth_recovery=1&code=outlook', replace).active).toBe(false);
  expect(replace).not.toHaveBeenCalled();
  for (const hash of ['type=recovery&access_token=x', 'type=recovery&access_token=x&access_token=y&refresh_token=z', 'type=recovery&access_token=x&refresh_token=y&error=expired']) {
    expect(captureRecovery('https://rev11.netlify.app/?rev_auth_recovery=1#'+hash, replace).credentials).toBeNull();
  }
});
it('does not accept an existing manager session without callback credentials', async () => {
  window.history.replaceState(null, '', '/?rev_auth_recovery=1');
  const { verifyRecovery } = await import('@/services/passwordRecovery');
  await expect(verifyRecovery()).rejects.toThrow('expired');
  expect(mocks.auth.getUser).not.toHaveBeenCalled();
});
it('consumes PKCE once and checks the server identity', async () => {
  window.history.replaceState(null, '', '/?rev_auth_recovery=1&code=private-code');
  const { verifyRecovery } = await import('@/services/passwordRecovery');
  await Promise.all([verifyRecovery(), verifyRecovery()]);
  expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  expect(mocks.auth.getUser).toHaveBeenCalledTimes(1);
  expect(window.location.search).not.toContain('private-code');
});
it('refuses callback identity mismatches', async () => {
  window.history.replaceState(null, '', '/?rev_auth_recovery=1#type=recovery&access_token=x&refresh_token=y');
  mocks.auth.getUser.mockResolvedValue({ data: { user: { id: 'other' } } });
  const { verifyRecovery } = await import('@/services/passwordRecovery');
  await expect(verifyRecovery()).rejects.toThrow('verified');
});
it('requests an email with a same-origin return and no automatic invitation acceptance', async () => {
  const { PasswordResetRequest } = await import('@/components/PasswordResetRequest');
  render(<PasswordResetRequest email=" staff@example.test " invitationId={id} />);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText(/If this email has an account/);
  const [email, options] = mocks.auth.resetPasswordForEmail.mock.calls[0];
  expect(email).toBe('staff@example.test');
  const url = new URL(options.redirectTo);
  expect(url.origin).toBe(window.location.origin);
  expect(url.searchParams.get('rev_team_invite')).toBe(id);
  expect(url.searchParams.get('rev_auth_recovery')).toBe('1');
});
it('validates before requesting and reports email request failures honestly', async () => {
  const { PasswordResetRequest } = await import('@/components/PasswordResetRequest');
  const view = render(<PasswordResetRequest email="" />);
  fireEvent.click(screen.getByRole('button')); expect(mocks.auth.resetPasswordForEmail).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Enter your email');
  mocks.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'private provider error' } });
  view.rerender(<PasswordResetRequest email="staff@example.test" />);
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText(/could not be completed/);
  expect(screen.queryByText('private provider error')).toBeNull();
});
it('shows password setup before an invitation, validates confirmation, saves and returns to the invitation', async () => {
  window.history.replaceState(null, '', '/?rev_auth_recovery=1&rev_team_invite='+id+'#type=recovery&access_token=x&refresh_token=y');
  const { PasswordRecoveryPanel } = await import('@/components/PasswordRecoveryPanel');
  render(<StrictMode><PasswordRecoveryPanel /></StrictMode>);
  await screen.findByLabelText('New password');
  expect(mocks.auth.setSession).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'New-private-password!' } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'Does-not-match!' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save password' }).closest('form')!);
  expect(await screen.findByText('The passwords do not match.')).toBeVisible();
  expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'New-private-password!' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save password' }).closest('form')!);
  await screen.findByText('Password saved. Sign in to continue.');
  expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: 'New-private-password!' });
  expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  expect(screen.getByRole('link')).toHaveAttribute('href', window.location.origin+'/?rev_team_invite='+id);
});
it('blocks a write when the signed-in account has changed', async () => {
  const { saveRecoveryPassword, passwordProblem } = await import('@/services/passwordRecovery');
  mocks.auth.getUser.mockResolvedValue({ data: { user: { id: 'other' } } });
  await expect(saveRecoveryPassword(id, 'a-long-password')).rejects.toThrow('session changed');
  expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  expect(passwordProblem('😀'.repeat(25), '😀'.repeat(25))).toContain('72 bytes');
});
it('does not expose an update error or claim that an uncertain save failed', async () => {
  const { saveRecoveryPassword } = await import('@/services/passwordRecovery');
  mocks.auth.updateUser.mockResolvedValue({ error: { message: 'database private' }, data: { user: null } });
  await expect(saveRecoveryPassword(id, 'a-long-password')).rejects.toThrow('not confirmed');
});
it('keeps an invalid or refreshed callback out of the password form', async () => {
  window.history.replaceState(null, '', '/?rev_auth_recovery=1&rev_team_invite='+id);
  const { PasswordRecoveryPanel } = await import('@/components/PasswordRecoveryPanel');
  render(<PasswordRecoveryPanel />);
  await screen.findByText(/This password link is unavailable/);
  expect(screen.queryByLabelText('New password')).toBeNull();
  expect(mocks.auth.updateUser).not.toHaveBeenCalled();
});
it('blocks duplicate password submissions while the first request is pending', async () => {
  window.history.replaceState(null, '', '/?rev_auth_recovery=1#type=recovery&access_token=x&refresh_token=y');
  let finish!: (value: unknown) => void;
  mocks.auth.updateUser.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const { PasswordRecoveryPanel } = await import('@/components/PasswordRecoveryPanel');
  render(<PasswordRecoveryPanel />);
  await screen.findByLabelText('New password');
  for (const label of ['New password', 'Confirm new password']) fireEvent.change(screen.getByLabelText(label), { target: { value: 'A-private-password!' } });
  const form = screen.getByRole('button', { name: 'Save password' }).closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(mocks.auth.updateUser).toHaveBeenCalledTimes(1));
  finish({ data: { user: { id } }, error: null });
  await screen.findByText('Password saved. Sign in to continue.');
});

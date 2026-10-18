import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import { passwordRecoveryEntry } from '@/services/passwordRecoveryBrowser';
import { passwordProblem, saveRecoveryPassword, verifyRecovery } from '@/services/passwordRecovery';
import { PasswordResetRequest } from './PasswordResetRequest';
export function PasswordRecoveryPanel() {
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState(''), [email, setEmail] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false), invalidated = useRef(false);
  useEffect(() => {
    let alive = true;
    void verifyRecovery().then(user => { if (alive && !invalidated.current) { setAccount(user); setEmail(user.email); } }).catch(() => { if (alive) setMessage('This password link is unavailable or has expired. Request a new link below.'); }).finally(() => { if (alive) setChecking(false); });
    const subscription = supabaseClient?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') invalidated.current = true;
      setAccount(current => {
        if (current && (!session || session.user.id !== current.id)) { invalidated.current = true; setPassword(''); setConfirmation(''); return null; }
        return current;
      });
    });
    return () => { alive = false; subscription?.data.subscription.unsubscribe(); };
  }, []);
  const back = new URL(window.location.origin + window.location.pathname);
  if (passwordRecoveryEntry.invitationId) back.searchParams.set('rev_team_invite', passwordRecoveryEntry.invitationId);
  return <main className="mx-auto max-w-xl space-y-4 px-6 py-12">
    <h1 className="text-2xl font-bold">Set your password</h1>
    {checking && <p role="status">Checking your password link...</p>}
    {message && <p role="status">{message}</p>}
    {saved ? <><p role="status">Password saved. Sign in to continue.</p><a className="btn-primary" href={back.href}>Return to sign in</a></> : account && !checking ? <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (pending.current) return;
      const problem = passwordProblem(password, confirmation); if (problem) { setMessage(problem); return; }
      pending.current = true; setBusy(true); setMessage('Saving password...');
      try {
        await saveRecoveryPassword(account.id, password);
        setPassword(''); setConfirmation(''); setSaved(true); setMessage('');
        try { const result = await supabaseClient?.auth.signOut({ scope: 'local' }); if (result?.error) setMessage('Password saved. Close this window and reopen your invitation to sign in.'); }
        catch { setMessage('Password saved. Close this window and reopen your invitation to sign in.'); }
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Password change not confirmed. Try signing in with your new password.'); }
      finally { setPassword(''); setConfirmation(''); pending.current = false; setBusy(false); }
    }}>
      <p>For {account.email}</p>
      <label className="block">New password<input type="password" className="mt-1 w-full rounded border p-3" autoComplete="new-password" required minLength={12} maxLength={72} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="block">Confirm new password<input type="password" className="mt-1 w-full rounded border p-3" autoComplete="new-password" required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      <button className="btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save password'}</button>
    </form> : !checking && <><label className="block">Your email<input type="email" className="mt-1 w-full rounded border p-3" value={email} onChange={e => setEmail(e.target.value)} /></label><PasswordResetRequest email={email} invitationId={passwordRecoveryEntry.invitationId} /></>}
  </main>;
}

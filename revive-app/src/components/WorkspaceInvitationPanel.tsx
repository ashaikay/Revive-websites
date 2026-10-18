import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import { acceptWorkspaceInvitation, invitationLink, teamId } from '@/services/workspaceTeam';

import { PasswordResetRequest } from './PasswordResetRequest';

export function WorkspaceInvitationPanel({ invitationId, onAccepted }: { invitationId: string; onAccepted: (workspaceId: string) => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'create'>('sign-in');
  const [account, setAccount] = useState<{ id: string; email: string } | null>(null);
  const [checking, setChecking] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const busyRef = useRef(false), alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!supabaseClient) { setChecking(false); setError('REV sign-in is unavailable.'); return; }
    const client = supabaseClient;
    const refresh = async () => {
      try {
        const result = await client.auth.getUser();
        if (alive.current) { setAccount(result.error || !result.data.user ? null : { id: result.data.user.id, email: result.data.user.email ?? '' }); setChecking(false); }
      } catch { if (alive.current) { setChecking(false); setError('Account could not be checked. Reload this invitation.'); } }
    };
    void refresh();
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (alive.current) { setAccount(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null); setPassword(''); }
    });
    return () => { alive.current = false; data.subscription.unsubscribe(); };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (failure: unknown) { if (alive.current) setError(failure instanceof Error ? failure.message : 'The request could not be completed.'); }
    finally { busyRef.current = false; if (alive.current) setBusy(false); }
  };
  if (!teamId.test(invitationId)) return <main className="mx-auto max-w-xl p-8"><h1 className="text-2xl font-bold">Invitation unavailable</h1><p className="mt-3">Ask your organisation manager for a valid invitation link.</p></main>;
  return <main className="mx-auto max-w-xl space-y-4 px-6 py-12">
    <h1 className="text-2xl font-bold">Join your REV team</h1>
    <p>Use the email address your manager invited. Programme access is assigned separately after you join.</p>
    {checking && <p role="status">Checking your account...</p>}
    {error && <p role="alert" className="rounded border p-3">{error}</p>}{message && <p role="status" className="rounded border p-3">{message}</p>}
    {!checking && !account && <>
      <div className="flex gap-2"><button type="button" disabled={busy} className={mode === 'sign-in' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setMode('sign-in'); setPassword(''); }}>Sign in</button><button type="button" disabled={busy} className={mode === 'create' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setMode('create'); setPassword(''); }}>Create account</button></div>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(async () => {
        if (!supabaseClient) throw new Error('REV sign-in is unavailable.');
        if (mode === 'create') {
          const { error } = await supabaseClient.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: invitationLink(invitationId, window.location) } });
          if (!alive.current) return;
          setPassword('');
          if (error) throw new Error('Account could not be created. Check the details or sign in if you already have an account.');
          setMessage('Check your email and confirm your account, then return to this invitation. If you already have an account, sign in.');
        } else {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email.trim(), password });
          if (!alive.current) return;
          setPassword('');
          if (error || !data.user) throw new Error('Sign-in failed. Check your email and password.');
          setAccount({ id: data.user.id, email: data.user.email ?? '' });
        }
      }); }}>
        <label className="block text-sm font-medium">Your email<input type="email" required autoComplete="email" maxLength={320} className="mt-1 w-full rounded border p-3" disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label className="block text-sm font-medium">Password<input type="password" required minLength={mode === 'create' ? 12 : 1} maxLength={72} autoComplete={mode === 'create' ? 'new-password' : 'current-password'} className="mt-1 w-full rounded border p-3" disabled={busy} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {mode === 'create' && <p className="text-sm">Use at least 12 characters. Keep your password private.</p>}
        <button className="btn-primary" disabled={busy}>{busy ? 'Please wait...' : mode === 'create' ? 'Create my account' : 'Sign in to continue'}</button>
      </form>
      <PasswordResetRequest email={email} invitationId={invitationId} />
    </>}
    {!checking && account && <div className="space-y-3">
      <p>Signed in as <strong>{account.email}</strong></p>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => void run(async () => { const accepted = await acceptWorkspaceInvitation(invitationId); if (alive.current) onAccepted(accepted.workspaceId); })}>{busy ? 'Checking invitation...' : 'Accept invitation'}</button>
      <button type="button" className="btn-secondary ml-2" disabled={busy} onClick={() => void run(async () => {
        if (!supabaseClient) throw new Error('Sign-out unavailable.');
        const { error } = await supabaseClient.auth.signOut(); if (error) throw new Error('Could not sign out.');
        if (alive.current) { setAccount(null); setPassword(''); }
      })}>Use another account</button>
    </div>}
  </main>;
}

import { useRef, useState } from 'react';
import { requestPassword } from '@/services/passwordRecovery';
export function PasswordResetRequest({ email, invitationId }: { email: string; invitationId?: string | null }) {
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return <div className="mt-4 space-y-2">
    <button type="button" className="btn-secondary" disabled={busy} onClick={async () => {
      if (pending.current) return;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage('Enter your email address first.'); return; }
      pending.current = true; setBusy(true); setMessage('Requesting password email...');
      try { await requestPassword(email, invitationId); setMessage('If this email has an account, a password link has been requested. Check your inbox and spam folder.'); }
      catch (error) { setMessage(error instanceof Error ? error.message : 'Email request not confirmed. Please try again later.'); }
      finally { pending.current = false; setBusy(false); }
    }}>{busy ? 'Requesting email...' : 'Forgot or need a password?'}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}

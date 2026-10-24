import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';

type AdviserOption = { userId: string; label: string };
type Action = 'record' | 'grant' | 'revoke' | 'withdraw';

/** Manager-only interface. Server RPCs remain the authority for every write. */
export function VocationalConsentManager({ assessmentId, advisers }: { assessmentId: string; advisers: AdviserOption[] }) {
  const [evidence, setEvidence] = useState('');
  const [statement, setStatement] = useState('');
  const [purpose, setPurpose] = useState('');
  const [adviserId, setAdviserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const scope = useRef({ assessmentId, token: Symbol() });
  const operation = useRef<symbol | null>(null);
  if (scope.current.assessmentId !== assessmentId) {
    scope.current = { assessmentId, token: Symbol() };
    operation.current = null;
  }
  useEffect(() => () => { scope.current.token = Symbol(); operation.current = null; }, []);
  useEffect(() => { setEvidence(''); setStatement(''); setPurpose(''); setAdviserId(''); setMessage(''); setError(''); setBusy(false); }, [assessmentId]);
  const submit = async (action: Action) => {
    if (!supabaseClient || busy || operation.current) return;
    if ((action === 'record' || action === 'withdraw') && (evidence.trim().length < 8 || statement.trim().length < 20)) {
      setError('Provide an evidence reference (at least 8 characters) and a participant statement (at least 20 characters).'); return;
    }
    if ((action === 'grant' || action === 'revoke') && !adviserId) { setError('Select an assigned adviser.'); return; }
    if (action === 'grant' && purpose.trim().length < 8) { setError('Provide an access purpose of at least 8 characters.'); return; }
    if ((action === 'withdraw' || action === 'revoke') && !window.confirm(`Confirm ${action === 'withdraw' ? 'consent withdrawal' : 'adviser access revocation'}?`)) return;
    const scopeToken = scope.current.token, operationToken = Symbol();
    operation.current = operationToken;
    const current = () => scope.current.token === scopeToken && operation.current === operationToken;
    setBusy(true); setError(''); setMessage('');
    try {
      const rpc = action === 'record' ? 'rev_voc_support_consent_record'
        : action === 'withdraw' ? 'rev_voc_support_consent_withdraw' : 'rev_voc_restricted_access_set';
      const args = action === 'record' || action === 'withdraw'
        ? { p_assessment_id: assessmentId, p_evidence_reference: evidence.trim(), p_statement: statement.trim() }
        : { p_assessment_id: assessmentId, p_adviser_user_id: adviserId, p_action: action, p_purpose: action === 'grant' ? purpose.trim() : null };
      const { error: rpcError } = await supabaseClient.rpc(rpc, args);
      if (!current()) return;
      if (rpcError) throw rpcError;
      setMessage(action === 'record' ? 'Consent recorded by the server.' : action === 'withdraw' ? 'Consent withdrawal recorded; restricted access is blocked.' : action === 'grant' ? 'Adviser grant recorded.' : 'Adviser access revoked.');
      setEvidence(''); setStatement(''); setPurpose('');
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Action not confirmed. Verify the record before trying again.'); }
    finally { if (current()) { operation.current = null; setBusy(false); } }
  };
  return <details className="rounded-lg border border-neutral-300 p-3" aria-label="Optional support consent management">
    <summary className="cursor-pointer font-semibold">Optional support — consent and adviser permissions (managers)</summary>
    <div className="mt-3 space-y-3 text-base">
      <p>Restricted support is optional and separate from core vocational matching. Record only evidence of the participant's actual decision. This panel does not display restricted answers or claim to show the current consent state.</p>
      <p className="text-sm text-amber-800">Existing consent and grants cannot yet be read in this interface. Confirm records through your authorised administrative process before recording a new consent or changing a grant.</p>
      <fieldset disabled={busy} className="space-y-3">
      <label className="block">Consent/withdrawal evidence reference<input className="mt-1 w-full rounded border p-2" maxLength={300} value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <label className="block">Participant's recorded consent or withdrawal statement<textarea className="mt-1 w-full rounded border p-2" rows={3} maxLength={2000} value={statement} onChange={e => setStatement(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busy} onClick={() => void submit('record')}>Record consent</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => void submit('withdraw')}>Record withdrawal</button></div>
      <label className="block">Assigned adviser<select className="mt-1 w-full rounded border p-2" value={adviserId} onChange={e => setAdviserId(e.target.value)}><option value="">Select adviser</option>{advisers.map(a => <option key={a.userId} value={a.userId}>{a.label}</option>)}</select></label>
      <label className="block">Purpose of restricted support access<input className="mt-1 w-full rounded border p-2" maxLength={500} value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busy || !adviserId} onClick={() => void submit('grant')}>Grant access</button><button type="button" className="btn-secondary" disabled={busy || !adviserId} onClick={() => void submit('revoke')}>Revoke access</button></div>
      </fieldset>
      {busy && <p role="status">Saving securely...</p>}{message && <p role="status" className="text-green-800">{message}</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </details>;
}

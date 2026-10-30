import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';

type AdviserOption = { userId: string; label: string };
type AccessStatus = { assessment_id: string; consent: 'none' | 'pending' | 'granted' | 'withdrawn'; grants: string[] };
type Action = 'record' | 'grant' | 'revoke' | 'withdraw';

/** Manager-only interface. Server RPCs remain the authority for every write. */
export function VocationalConsentManager({ assessmentId, advisers }: { assessmentId: string; advisers: AdviserOption[] }) {
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [uncertain, setUncertain] = useState(false);
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
  const checkStatus = async () => {
    if (!supabaseClient || operation.current) return;
    const scopeToken = scope.current.token, operationToken = Symbol();
    operation.current = operationToken;
    const current = () => scope.current.token === scopeToken && operation.current === operationToken;
    setChecking(true); setStatus(null); setError('');
    try {
      const { data, error: readError } = await supabaseClient.rpc('rev_voc_support_access_status', { p_assessment_id: assessmentId });
      if (!current()) return;
      if (readError || !data || data.assessment_id !== assessmentId || !['none', 'pending', 'granted', 'withdrawn'].includes(data.consent) || !Array.isArray(data.grants) || !data.grants.every((id: unknown) => typeof id === 'string')) throw new Error('Status unavailable');
      setStatus(data); setUncertain(false);
    } catch { if (current()) setError('Could not check consent and adviser access. Changes are paused. Try Check current permissions again.'); }
    finally { if (current()) { operation.current = null; setChecking(false); } }
  };
  useEffect(() => { setStatus(null); setUncertain(false); setChecking(false); void checkStatus(); }, [assessmentId]);
  const submit = async (action: Action) => {
    if (!supabaseClient || busy || operation.current || !status || status.assessment_id !== assessmentId || uncertain) return;
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
      setEvidence(''); setStatement(''); setPurpose(''); setStatus(null);
    } catch { if (current()) { setUncertain(true); setStatus(null); setError('This change is not confirmed. Do not repeat it. Check current permissions before making another change.'); } }
    finally { if (current()) { operation.current = null; setBusy(false); } }
  };
  return <details className="rounded-lg border border-neutral-300 p-3" aria-label="Optional support consent management">
    <summary className="cursor-pointer font-semibold">Sensitive support permissions (managers)</summary>
    <div className="mt-3 space-y-3 text-sm">
      <p>This optional area controls access to sensitive support information. You do not need it to complete the ordinary vocational questions.</p>
      <p className="text-sm text-neutral-600">Only record consent the participant has actually given. Permission to access this information does not assign an adviser to the caseload.</p>
      <button type="button" className="btn-secondary" disabled={busy || checking} onClick={() => void checkStatus()}>Check current permissions</button>
      {checking && <p role="status">Checking current permissions...</p>}
      {status && <div role="status"><p>Participant consent: {status.consent === 'none' ? 'Not recorded' : status.consent}.</p><p>Adviser permissions apply to this Service user. Consent applies to this questionnaire.</p><ul>{Array.from(new Set([...advisers.map(a => a.userId), ...status.grants])).map(id => <li key={id}>{advisers.find(a => a.userId === id)?.label ?? 'Previously assigned adviser'}: {status.grants.includes(id) ? status.consent === 'granted' && advisers.some(a => a.userId === id) ? 'Permission recorded' : 'Permission recorded; access blocked without current consent and assignment' : 'No permission recorded'}</li>)}</ul></div>}
      {status?.consent === 'withdrawn' && <p>Consent was withdrawn. This screen cannot replace that record or reinstate consent.</p>}
      {!status && !checking && <p>Check current permissions to continue. Ordinary vocational questions are still available.</p>}
      <fieldset disabled={busy || checking || !status || uncertain} className="space-y-3">
      <label className="block">Consent/withdrawal evidence reference<input className="mt-1 w-full rounded border p-2" maxLength={300} value={evidence} onChange={e => setEvidence(e.target.value)} /></label>
      <label className="block">Participant's recorded consent or withdrawal statement<textarea className="mt-1 w-full rounded border p-2" rows={3} maxLength={2000} value={statement} onChange={e => setStatement(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busy || status?.consent !== 'none'} onClick={() => void submit('record')}>Record consent</button><button type="button" className="btn-secondary" disabled={busy || status?.consent !== 'granted'} onClick={() => void submit('withdraw')}>Record withdrawal</button></div>
      <label className="block">Assigned adviser<select className="mt-1 w-full rounded border p-2" value={adviserId} onChange={e => setAdviserId(e.target.value)}><option value="">Select adviser</option>{[...advisers, ...(status?.grants ?? []).filter(id => !advisers.some(a => a.userId === id)).map(userId => ({ userId, label: 'Previously assigned adviser' }))].map(a => <option key={a.userId} value={a.userId}>{a.label}</option>)}</select></label>
      <label className="block">Purpose of restricted support access<input className="mt-1 w-full rounded border p-2" maxLength={500} value={purpose} onChange={e => setPurpose(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary" disabled={busy || !adviserId || status?.consent !== 'granted' || status.grants.includes(adviserId)} onClick={() => void submit('grant')}>Grant access</button><button type="button" className="btn-secondary" disabled={busy || !adviserId || !status?.grants.includes(adviserId)} onClick={() => void submit('revoke')}>Revoke access</button></div>
      </fieldset>
      {busy && <p role="status">Saving securely...</p>}{message && <p role="status" className="text-green-800">{message}</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </details>;
}

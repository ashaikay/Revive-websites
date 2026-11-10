import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import { clearActionPlanAttempt, rememberActionPlanAttempt, restoreActionPlanAttempt, type ActionPlanAttempt, type ActionPlanSavePayload } from '@/services/actionPlanRetainedRequest';

export type ActionStatus = 'not_started' | 'in_progress' | 'completed';
export type PlanAction = {
  id: string;
  description: string;
  ownerType: 'service_user' | 'employment_specialist';
  ownerUserId: string | null;
  status: ActionStatus;
  targetDate: string | null;
  ownerNeedsReview?: boolean;
};
type Revision = {
  revision: number; employmentGoal: string; actions: PlanAction[]; templateVersionId: string;
  questionnaireTitle: string; questionnaireVersion: number; savedByUserId: string; savedAt: string;
};
type Questionnaire = { templateVersionId: string; title: string; version: number };
export type ActionPlanRead = {
  plan: { planId: string; currentRevision: number; updatedAt: string } | null;
  revisions: Revision[];
  currentQuestionnaire: Questionnaire | null;
  reviewNeeded: boolean;
  assignedSpecialistIds: string[];
};
type Draft = { goal: string; actions: PlanAction[] };
type PlanSummary = { status: 'not_loaded' | 'unavailable' } | { status: 'loaded'; revision: number | null };

const statusLabels: Record<ActionStatus, string> = { not_started: 'Not started', in_progress: 'In progress', completed: 'Completed' };
const newId = () => globalThis.crypto.randomUUID();
const stripFlags = (actions: PlanAction[]): PlanAction[] => actions.map(({ id, description, ownerType, ownerUserId, status, targetDate }) => ({ id, description, ownerType, ownerUserId, status, targetDate }));
const formatDate = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('en-GB');
const saveFailure = (cause: unknown) => {
  const code = typeof cause === 'object' && cause && 'code' in cause ? String((cause as { code: unknown }).code) : '';
  if (code === '40001') return 'This plan was changed by someone else or the request was already used. Your edits remain on screen; close and reopen the plan to see the latest revision.';
  if (code === '42501') return 'You no longer have access to this Service user\'s action plan. Nothing was saved.';
  if (code === '22023') return 'The plan could not be saved. Check each action has a description and an owner who is currently assigned. Nothing was saved.';
  return 'Save not confirmed. Editing is paused so the plan cannot be replaced. Select Retry save to resend the exact same request; it will not create a duplicate revision.';
};
const retainedUnreadable = 'A retained action plan save could not be read. Nothing new can be saved here; contact support before making another change.';
const definitiveCodes = new Set(['40001', '42501', '22023']);

export function ParticipantActionPlan({ workspaceId, userId, programmeId, participantId, assignableSpecialists = [], staffLabel = () => 'Staff member', onNavigationLockChange, readOnly = false }: {
  workspaceId: string; userId: string; programmeId: string; participantId: string;
  readOnly?: boolean;
  assignableSpecialists?: { userId: string; label: string }[];
  staffLabel?: (userId: string) => string;
  onNavigationLockChange?: (locked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ActionPlanRead | null>(null);
  const [summary, setSummary] = useState<PlanSummary>({ status: 'not_loaded' });
  const [draft, setDraft] = useState<Draft>({ goal: '', actions: [] });
  const [dirty, setDirty] = useState(false);
  const [linkCurrent, setLinkCurrent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState<number | null>(null);
  const [reload, setReload] = useState(0);
  // An unconfirmed save is retained (in sessionStorage too) until an exact replay resolves it.
  const [retained, setRetained] = useState<ActionPlanAttempt | null>(null);
  const [retainedInvalid, setRetainedInvalid] = useState(false);
  const scopeKey = JSON.stringify([workspaceId, userId, programmeId, participantId]);
  const scope = useRef({ key: scopeKey, token: Symbol() });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, token: Symbol() };
  useEffect(() => {
    setOpen(false); setData(null); setDraft({ goal: '', actions: [] }); setDirty(false); setLinkCurrent(false);
    setSummary({ status: 'not_loaded' });
    setLoading(false); setSaving(false); setError(''); setNotice(''); setViewing(null);
    setRetained(null); setRetainedInvalid(false);
    try {
      const attempt = restoreActionPlanAttempt(window.sessionStorage, workspaceId, userId, programmeId);
      if (attempt?.participantId === participantId) {
        setRetained(attempt); setOpen(true);
        setError(saveFailure(null));
      }
    } catch {
      setRetainedInvalid(true); setOpen(true); setError(retainedUnreadable);
    }
  }, [scopeKey]);
  useEffect(() => () => { scope.current.token = Symbol(); }, []);
  const locked = saving || !!retained || retainedInvalid;
  useEffect(() => { onNavigationLockChange?.(locked); }, [locked, onNavigationLockChange]);
  useEffect(() => () => onNavigationLockChange?.(false), [onNavigationLockChange]);
  const retainedRef = useRef(retained);
  retainedRef.current = retained;

  useEffect(() => {
    if (!open) return;
    const token = scope.current.token;
    setLoading(true);
    if (!retainedRef.current && !retainedInvalid) setError('');
    void (async () => {
      try {
        if (!supabaseClient) throw new Error('Database connection unavailable.');
        const { data: result, error: rpcError } = await supabaseClient.rpc('rev_action_plan_read', {
          target_workspace_id: workspaceId, target_programme_id: programmeId, target_participant_id: participantId,
        });
        if (scope.current.token !== token) return;
        if (rpcError) throw rpcError;
        const value = result as ActionPlanRead;
        if (!value || !Array.isArray(value.revisions) || !Array.isArray(value.assignedSpecialistIds)) throw new Error('Action plan could not be verified.');
        setData(value);
        setSummary({ status: 'loaded', revision: value.plan?.currentRevision ?? null });
        const latest = value.revisions[0];
        const pendingSave = retainedRef.current;
        if (pendingSave) {
          // Show exactly what the retained request will resend; editing stays paused.
          setDraft({ goal: pendingSave.payload.target_goal, actions: pendingSave.payload.target_actions as PlanAction[] });
          setDirty(true);
          setLinkCurrent(!!latest && pendingSave.payload.target_template_version_id !== latest.templateVersionId);
        } else {
          setDraft(latest ? { goal: latest.employmentGoal, actions: stripFlags(latest.actions) } : { goal: '', actions: [] });
          setDirty(false); setLinkCurrent(false);
        }
        setViewing(null);
      } catch (cause) {
        if (scope.current.token === token) {
          setSummary((previous) => previous.status === 'loaded' && previous.revision !== null ? previous : { status: 'unavailable' });
          if (!retainedRef.current) setError(cause instanceof Error && cause.message === 'Action plan could not be verified.' ? cause.message : 'Action plan unavailable. Nothing has been changed.');
        }
      } finally {
        if (scope.current.token === token) setLoading(false);
      }
    })();
  }, [open, reload, workspaceId, userId, programmeId, participantId]);

  const latest = data?.revisions[0] ?? null;
  const assignedIds = new Set(data?.assignedSpecialistIds ?? []);
  const specialistOptions = assignableSpecialists.filter((specialist) => assignedIds.has(specialist.userId));
  const linkedVersion = !latest ? data?.currentQuestionnaire?.templateVersionId ?? null
    : data?.reviewNeeded && linkCurrent ? data.currentQuestionnaire?.templateVersionId ?? null
      : latest.templateVersionId;
  const editable = !readOnly && !loading && !saving && !retained && !retainedInvalid;
  const invalid = !draft.goal.trim() || draft.actions.some((action) => !action.description.trim() || (action.ownerType === 'employment_specialist' && !action.ownerUserId));
  const ownerNeedsReview = (action: PlanAction) => action.ownerType === 'employment_specialist' && !!action.ownerUserId && !assignedIds.has(action.ownerUserId);

  const edit = (next: Draft) => { if (!editable) return; setDraft(next); setDirty(true); setNotice(''); };
  const updateAction = (id: string, patch: Partial<PlanAction>) => edit({ ...draft, actions: draft.actions.map((action) => action.id === id ? { ...action, ...patch } : action) });

  const save = async () => {
    if (!supabaseClient || saving || retainedInvalid || (readOnly && !retained)) return;
    let attempt = retained;
    if (!attempt) {
      if (!data || !linkedVersion || !dirty || invalid) return;
      const payload: ActionPlanSavePayload = {
        target_workspace_id: workspaceId, target_programme_id: programmeId, target_participant_id: participantId,
        expected_revision: data.plan?.currentRevision ?? 0, target_template_version_id: linkedVersion,
        target_goal: draft.goal.trim(),
        target_actions: draft.actions.map((action) => ({ ...action, description: action.description.trim() })),
      };
      attempt = { userId, workspaceId, programmeId, participantId, requestId: newId(), payload };
      try {
        // Retain before sending so a refresh during an unknown outcome still replays this exact request.
        rememberActionPlanAttempt(window.sessionStorage, attempt);
      } catch {
        setError('This save could not be prepared safely in this browser. Nothing was sent.');
        return;
      }
      setRetained(attempt);
    }
    const { payload, requestId } = attempt;
    const token = scope.current.token;
    setSaving(true); setError(''); setNotice('');
    const resolve = () => {
      try { clearActionPlanAttempt(window.sessionStorage, workspaceId, userId, programmeId); } catch { /* cleared in memory below */ }
      setRetained(null);
    };
    try {
      const { data: result, error: rpcError } = await supabaseClient.rpc('rev_action_plan_save', { ...payload, target_request_id: requestId });
      if (scope.current.token !== token) return;
      if (rpcError) throw rpcError;
      const saved = result as { revision: number; templateVersionId: string };
      if (saved?.revision !== payload.expected_revision + 1 || saved.templateVersionId !== payload.target_template_version_id) throw new Error('unverified');
      resolve();
      setSummary({ status: 'loaded', revision: saved.revision });
      setDirty(false);
      setNotice(`Revision ${saved.revision} saved. Earlier revisions are kept unchanged.`);
      setReload((value) => value + 1);
    } catch (cause) {
      if (scope.current.token !== token) return;
      const code = typeof cause === 'object' && cause && 'code' in cause ? String((cause as { code: unknown }).code) : '';
      // Definitive rejections will not succeed on an exact replay; anything else stays retained.
      if (definitiveCodes.has(code)) resolve();
      setError(saveFailure(cause));
    } finally {
      if (scope.current.token === token) setSaving(false);
    }
  };

  const viewed = viewing === null ? null : data?.revisions.find((revision) => revision.revision === viewing) ?? null;

  return <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Employment action plan">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-neutral-900">Employment action plan</h3>
        <p className="text-base text-neutral-700">{summary.status === 'loaded'
          ? summary.revision === null ? 'No plan saved yet' : `Revision ${summary.revision}`
          : summary.status === 'unavailable' ? 'Action plan unavailable'
            : loading ? 'Loading action plan...' : 'Action plan not loaded'}</p>
      </div>
      <button type="button" className={`rev-outcomes-profile-action ${open ? 'btn-secondary' : 'btn-primary'}`} disabled={locked} aria-expanded={open}
        onClick={() => { if (locked) return; if (open && dirty && !window.confirm('Discard unsaved action plan changes?')) return; if (open) { setData(null); setDirty(false); setError(''); setNotice(''); } setOpen(!open); }}>
        {open ? 'Close action plan' : 'Open action plan'}
      </button>
    </div>
    {open && <div className="mt-4 space-y-4">
      <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800">Recorded by staff for employment support. Saving does not record the Service user's agreement, send messages, make applications or complete anything automatically. Do not record health, offence, safeguarding or other sensitive details here.</p>
      {readOnly && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Archived record - action-plan revisions are read-only. Revision history remains available.</p>}
      {loading && <p role="status" className="text-base">Loading action plan...</p>}
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      {notice && <p role="status" className="text-base text-green-700">{notice}</p>}
      {retained && !data && !loading && <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving...' : 'Retry save'}</button>}
      {data && !loading && !latest && !data.currentQuestionnaire && <p className="text-base">A published vocational questionnaire is needed for this programme before an action plan can be started.</p>}
      {data && !loading && (latest || data.currentQuestionnaire) && <>
        <p className="text-base text-neutral-700">Linked questionnaire: {latest ? `${latest.questionnaireTitle} - version ${latest.questionnaireVersion}` : `${data.currentQuestionnaire!.title} - version ${data.currentQuestionnaire!.version}`}</p>
        {data.reviewNeeded && data.currentQuestionnaire && <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
          <p className="font-medium">Review needed</p>
          <p>A newer questionnaire ({data.currentQuestionnaire.title} - version {data.currentQuestionnaire.version}) has been published since this plan was saved. The plan and its history are unchanged.</p>
          <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={linkCurrent} disabled={!editable} onChange={(event) => { if (!editable) return; setLinkCurrent(event.target.checked); setDirty(true); setNotice(''); }} />Link the next revision to the current questionnaire after reviewing this plan</label>
        </div>}
        <label className="block text-base font-medium">Employment goal
          <textarea className="mt-1 w-full rounded border border-neutral-300 p-2 font-normal" rows={2} maxLength={500} disabled={!editable} value={draft.goal} onChange={(event) => edit({ ...draft, goal: event.target.value })} />
        </label>
        <div className="space-y-3">
          <h4 className="text-base font-semibold">Actions</h4>
          {draft.actions.length === 0 && <p className="text-sm text-neutral-600">No actions recorded yet.</p>}
          {draft.actions.map((action, index) => {
            const flagged = ownerNeedsReview(action);
            const ownerValue = action.ownerType === 'service_user' ? 'service_user' : action.ownerUserId ?? '';
            return <fieldset key={action.id} className="grid gap-2 rounded-lg border border-neutral-200 p-3 md:grid-cols-2" aria-label={`Action ${index + 1}`}>
              <label className="text-sm font-medium md:col-span-2">Action
                <input className="mt-1 w-full rounded border border-neutral-300 p-2 font-normal" maxLength={300} disabled={!editable} value={action.description} onChange={(event) => updateAction(action.id, { description: event.target.value })} />
              </label>
              <label className="text-sm font-medium">Responsible for this action
                <select className="mt-1 w-full rounded border border-neutral-300 p-2 font-normal" disabled={!editable} value={ownerValue}
                  onChange={(event) => updateAction(action.id, event.target.value === 'service_user' ? { ownerType: 'service_user', ownerUserId: null } : { ownerType: 'employment_specialist', ownerUserId: event.target.value || null })}>
                  <option value="service_user">Service user</option>
                  {specialistOptions.map((specialist) => <option key={specialist.userId} value={specialist.userId}>Assigned Employment Specialist: {specialist.label}</option>)}
                  {flagged && <option value={action.ownerUserId!}>{staffLabel(action.ownerUserId!)} (no longer assigned)</option>}
                  {action.ownerType === 'employment_specialist' && !action.ownerUserId && <option value="">Select an Employment Specialist</option>}
                </select>
              </label>
              <label className="text-sm font-medium">Status
                <select className="mt-1 w-full rounded border border-neutral-300 p-2 font-normal" disabled={!editable} value={action.status} onChange={(event) => updateAction(action.id, { status: event.target.value as ActionStatus })}>
                  {(Object.keys(statusLabels) as ActionStatus[]).map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium">Target date (optional)
                <input type="date" className="mt-1 w-full rounded border border-neutral-300 p-2 font-normal" disabled={!editable} value={action.targetDate ?? ''} onChange={(event) => updateAction(action.id, { targetDate: event.target.value || null })} />
              </label>
              <div className="flex items-end"><button type="button" className="btn-secondary" disabled={!editable} onClick={() => edit({ ...draft, actions: draft.actions.filter((item) => item.id !== action.id) })}>Remove action</button></div>
              {flagged && <p role="status" className="text-sm text-amber-800 md:col-span-2">Owner needs review: {staffLabel(action.ownerUserId!)} is no longer assigned to this Service user. The recorded owner has not been changed.</p>}
            </fieldset>;
          })}
          <button type="button" className="btn-secondary" disabled={!editable || draft.actions.length >= 20}
            onClick={() => edit({ ...draft, actions: [...draft.actions, { id: newId(), description: '', ownerType: 'service_user', ownerUserId: null, status: 'not_started', targetDate: null }] })}>Add action</button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-primary" disabled={retained ? saving : (readOnly || !dirty || invalid || saving || loading || !linkedVersion || retainedInvalid)} onClick={() => void save()}>{saving ? 'Saving...' : retained ? 'Retry save' : 'Save revision'}</button>
          {dirty && !saving && !retained && <span className="text-sm text-neutral-600">Unsaved changes</span>}
        </div>
        {data.revisions.length > 0 && <details className="rounded-lg border border-neutral-200 p-3">
          <summary className="cursor-pointer text-base font-medium">Revision history ({data.revisions.length})</summary>
          <ul className="mt-2 space-y-1">
            {data.revisions.map((revision) => <li key={revision.revision}>
              <button type="button" className="text-left text-base underline" aria-pressed={viewing === revision.revision} onClick={() => setViewing(viewing === revision.revision ? null : revision.revision)}>
                Revision {revision.revision}{revision.revision === latest?.revision ? ' (current)' : ''} - saved {new Date(revision.savedAt).toLocaleString('en-GB')} by {staffLabel(revision.savedByUserId)}
              </button>
            </li>)}
          </ul>
          {viewed && <div className="mt-3 rounded-lg bg-neutral-50 p-3 text-base" aria-label={`Revision ${viewed.revision} (read-only)`}>
            <p className="font-medium">Revision {viewed.revision} (read-only)</p>
            <p>Questionnaire: {viewed.questionnaireTitle} - version {viewed.questionnaireVersion}</p>
            <p>Employment goal: {viewed.employmentGoal}</p>
            {viewed.actions.length === 0 ? <p>No actions recorded.</p> : <ul className="mt-1 list-disc pl-5">
              {viewed.actions.map((action) => <li key={action.id}>{action.description} - {action.ownerType === 'service_user' ? 'Service user' : `Employment Specialist: ${staffLabel(action.ownerUserId ?? '')}`} - {statusLabels[action.status]}{action.targetDate ? ` - target ${formatDate(action.targetDate)}` : ''}</li>)}
            </ul>}
          </div>}
        </details>}
      </>}
    </div>}
  </section>;
}

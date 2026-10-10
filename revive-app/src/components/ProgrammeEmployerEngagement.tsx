import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import {
  defaultEmployerDiscoveryExclusions,
  defaultEmployerDiscoveryLocation,
  defaultEmployerDiscoverySectors,
  employerDiscoverySectors,
  employerEngagementStages,
  type EmployerDiscoveryAttempt,
  type EmployerDiscoveryFilters,
  type EmployerDiscoveryResult,
  type EmployerEngagementData,
  type EmployerEngagementSaveAttempt,
  type EmployerOutreachAttempt,
} from '@/domain/programmeEmployerEngagement';
import type {
  ProgrammeHubAdviser,
  ProgrammeHubEmployer,
  ProgrammeHubEmployerContact,
  ProgrammeHubMember,
  ProgrammeHubProgramme,
} from '@/domain/programmeHub';
import {
  checkEmployerDiscoveryAvailability,
  checkEmployerOutreachAvailability,
  clearEmployerAttempt,
  loadEmployerEngagementData,
  rememberEmployerAttempt,
  restoreEmployerAttempt,
  submitEmployerDiscovery,
  submitEmployerEngagementSave,
  submitEmployerOutreachDraft,
  type EmployerEngagementInvokeGateway,
} from '@/services/programmeEmployerEngagementService';

const emptyEngagementData: EmployerEngagementData = { searches: [], employerSources: [], settings: null, engagements: [], events: [], drafts: [] };
const fieldClass = 'w-full rounded-md border border-neutral-300 px-3 py-2';
const normalized = (value: string) => value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
const split = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

async function invoke(name: string, body: Record<string, unknown>) {
  if (!supabaseClient) throw new Error('Programme Hub is unavailable.');
  const { data, error } = await supabaseClient.functions.invoke(name, { body });
  if (!error) return { status: 200, data };
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) return { status: context.status, data: await context.clone().json().catch(() => null) };
  throw new Error('Request outcome is unknown.');
}

export function ProgrammeEmployerEngagement({
  workspaceId,
  userId,
  programme,
  employers,
  contacts,
  advisers,
  members,
  isManager,
  canMaintain,
  onEmployersChanged,
}: {
  workspaceId: string;
  userId: string;
  programme: ProgrammeHubProgramme;
  employers: ProgrammeHubEmployer[];
  contacts: ProgrammeHubEmployerContact[];
  advisers: ProgrammeHubAdviser[];
  members: ProgrammeHubMember[];
  isManager: boolean;
  canMaintain: boolean;
  onEmployersChanged(): Promise<void>;
}) {
  const contextKey = `${workspaceId}:${programme.id}`;
  const contextRef = useRef(contextKey);
  contextRef.current = contextKey;
  const [data, setData] = useState<EmployerEngagementData>(emptyEngagementData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [discoveryAvailability, setDiscoveryAvailability] = useState<{ available: boolean; provider: 'Companies House' } | null>(null);
  const [outreachAvailability, setOutreachAvailability] = useState<{ available: boolean; model: string | null } | null>(null);
  const [filters, setFilters] = useState<EmployerDiscoveryFilters>({
    location: defaultEmployerDiscoveryLocation,
    sectors: [...defaultEmployerDiscoverySectors],
    excludeTerms: [...defaultEmployerDiscoveryExclusions],
  });
  const [results, setResults] = useState<EmployerDiscoveryResult[]>([]);
  const [pendingSearch, setPendingSearch] = useState<EmployerDiscoveryAttempt | null>(null);
  const [pendingSave, setPendingSave] = useState<EmployerEngagementSaveAttempt | null>(null);
  const [pendingDraft, setPendingDraft] = useState<EmployerOutreachAttempt | null>(null);
  const [selectedEmployerId, setSelectedEmployerId] = useState('');
  const [offerSummary, setOfferSummary] = useState('');
  const [engagementDraft, setEngagementDraft] = useState({ stage: 'to_review', responsibleAdviserUserId: '', nextAction: '', followUpDate: '' });
  const [historyDraft, setHistoryDraft] = useState({ contactId: '', eventType: 'manual_contact', channel: 'email', summary: '' });
  const [draftContactId, setDraftContactId] = useState('');
  const [draftEdit, setDraftEdit] = useState({ draftId: '', revision: 0, subject: '', body: '' });

  const gateway = useMemo<EmployerEngagementInvokeGateway>(() => ({ invoke }), []);
  const load = async (captured = contextKey) => {
    const client = supabaseClient;
    if (!client) throw new Error('Programme Hub is unavailable.');
    const loaded = await loadEmployerEngagementData(workspaceId, programme.id, {
      read: async (table, columns, ws, programmeId) => {
        let query = client.from(table).select(columns).eq('workspace_id', ws).eq('programme_id', programmeId);
        if (table === 'programme_hub_employer_outreach_drafts') query = query.eq('current', true);
        const { data: rows, error: readError } = await query.order('created_at', { ascending: false });
        if (readError) throw new Error('Employer engagement workspace could not be loaded.');
        return rows;
      },
    });
    if (contextRef.current !== captured) return;
    setData(loaded);
    setOfferSummary(loaded.settings?.offerSummary ?? '');
    const currentEmployerId = employers.some((employer) => employer.id === selectedEmployerId) ? selectedEmployerId : employers[0]?.id ?? '';
    setSelectedEmployerId(currentEmployerId);
    const search = loaded.searches.find((item) => item.status === 'succeeded' && item.results);
    setResults(search?.results ?? []);
    setReady(true);
  };

  useEffect(() => {
    let active = true;
    const captured = contextKey;
    setReady(false);
    setError('');
    setMessage('');
    setData(emptyEngagementData);
    setResults([]);
    setSelectedEmployerId('');
    setDiscoveryAvailability(null);
    setOutreachAvailability(null);
    try {
      setPendingSearch(restoreEmployerAttempt<EmployerDiscoveryAttempt>(window.sessionStorage, 'search', workspaceId, userId, programme.id));
      setPendingSave(restoreEmployerAttempt<EmployerEngagementSaveAttempt>(window.sessionStorage, 'save', workspaceId, userId, programme.id));
      setPendingDraft(restoreEmployerAttempt<EmployerOutreachAttempt>(window.sessionStorage, 'draft', workspaceId, userId, programme.id));
    } catch {
      setError('A retained employer engagement request could not be read. Contact support before making another change.');
    }
    void Promise.all([
      load(captured),
      checkEmployerDiscoveryAvailability(workspaceId, programme.id, gateway).then((value) => {
        if (active && contextRef.current === captured) setDiscoveryAvailability(value);
      }),
      checkEmployerOutreachAvailability(workspaceId, programme.id, gateway).then((value) => {
        if (active && contextRef.current === captured) setOutreachAvailability(value);
      }),
    ]).catch((loadError: unknown) => {
      if (active && contextRef.current === captured) {
        setReady(true);
        setError(loadError instanceof Error ? loadError.message : 'Employer engagement workspace could not be loaded.');
      }
    });
    return () => { active = false; };
  }, [contextKey, gateway, programme.id, userId, workspaceId]);

  useEffect(() => {
    if (!selectedEmployerId) return;
    const engagement = data.engagements.find((item) => item.employerId === selectedEmployerId);
    setEngagementDraft({
      stage: engagement?.stage ?? 'to_review',
      responsibleAdviserUserId: engagement?.responsibleAdviserUserId ?? '',
      nextAction: engagement?.nextAction ?? '',
      followUpDate: engagement?.followUpDate ?? '',
    });
    setHistoryDraft({ contactId: '', eventType: 'manual_contact', channel: 'email', summary: '' });
    setDraftContactId('');
    const draft = data.drafts.find((item) => item.employerId === selectedEmployerId);
    setDraftEdit(draft ? { draftId: draft.draftId, revision: draft.revision, subject: draft.subject, body: draft.body } : { draftId: '', revision: 0, subject: '', body: '' });
  }, [data.drafts, data.engagements, selectedEmployerId]);

  useEffect(() => {
    setSelectedEmployerId((current) => employers.some((employer) => employer.id === current) ? current : employers[0]?.id ?? '');
  }, [employers]);

  const retainAndSave = async (attempt: EmployerEngagementSaveAttempt, success: string) => {
    if (busy) return;
    const captured = contextKey;
    setBusy(true);
    setError('');
    setMessage('');
    setPendingSave(attempt);
    rememberEmployerAttempt(window.sessionStorage, 'save', workspaceId, userId, programme.id, attempt);
    try {
      const saved = await submitEmployerEngagementSave(attempt, gateway);
      clearEmployerAttempt(window.sessionStorage, 'save', workspaceId, userId, programme.id);
      setPendingSave(null);
      if (attempt.operation === 'discovery_employer') await onEmployersChanged();
      await load();
      if (contextRef.current !== captured) return;
      setMessage(saved.duplicate ? 'This Companies House employer is already saved. The existing record was left unchanged.' : success);
    } catch (saveError) {
      if (contextRef.current === captured) setError(saveError instanceof Error ? saveError.message : 'Employer engagement save not confirmed.');
    } finally {
      if (contextRef.current === contextKey) setBusy(false);
    }
  };

  const runSearch = async (attempt: EmployerDiscoveryAttempt) => {
    if (busy) return;
    const captured = contextKey;
    setBusy(true);
    setError('');
    setMessage('');
    setPendingSearch(attempt);
    rememberEmployerAttempt(window.sessionStorage, 'search', workspaceId, userId, programme.id, attempt);
    try {
      const outcome = await submitEmployerDiscovery(attempt, gateway);
      clearEmployerAttempt(window.sessionStorage, 'search', workspaceId, userId, programme.id);
      if (contextRef.current !== captured) return;
      setPendingSearch(null);
      setResults(outcome.results ?? []);
      await load();
      setMessage(`Companies House returned ${outcome.results?.length ?? 0} registry result${outcome.results?.length === 1 ? '' : 's'} for review.`);
    } catch (searchError) {
      if (contextRef.current === captured) setError(searchError instanceof Error ? searchError.message : 'Employer discovery outcome is unconfirmed.');
    } finally {
      if (contextRef.current === contextKey) setBusy(false);
    }
  };

  const runDraft = async (attempt: EmployerOutreachAttempt) => {
    if (busy) return;
    const captured = contextKey;
    setBusy(true);
    setError('');
    setMessage('');
    setPendingDraft(attempt);
    rememberEmployerAttempt(window.sessionStorage, 'draft', workspaceId, userId, programme.id, attempt);
    try {
      const outcome = await submitEmployerOutreachDraft(attempt, gateway);
      if (!outcome.draft) throw new Error('Outreach draft outcome is unconfirmed.');
      clearEmployerAttempt(window.sessionStorage, 'draft', workspaceId, userId, programme.id);
      if (contextRef.current !== captured) return;
      setPendingDraft(null);
      await load();
      setMessage('Employer outreach draft prepared for specialist review. Nothing was sent.');
    } catch (draftError) {
      if (contextRef.current === captured) setError(draftError instanceof Error ? draftError.message : 'Outreach draft outcome is unconfirmed.');
    } finally {
      if (contextRef.current === contextKey) setBusy(false);
    }
  };

  const enrichedEmployers = employers.map((employer) => {
    const source = data.employerSources.find((item) => item.employerId === employer.id);
    return source ? { ...employer, ...source, id: employer.id } : employer;
  });
  const selectedEmployer = enrichedEmployers.find((item) => item.id === selectedEmployerId) ?? null;
  const selectedEngagement = data.engagements.find((item) => item.employerId === selectedEmployerId) ?? null;
  const selectedContacts = contacts.filter((item) => item.employerId === selectedEmployerId);
  const selectedEvents = data.events.filter((item) => item.employerId === selectedEmployerId);
  const activeAdvisers = advisers.filter((item) => item.active).map((item) => ({
    ...item,
    label: item.userId === userId
      ? 'You'
      : `${members.find((member) => member.userId === item.userId)?.role === 'owner' ? 'Owner' : members.find((member) => member.userId === item.userId)?.role === 'admin' ? 'Administrator' : 'Employment Specialist'} ending ${item.userId.slice(-6)}`,
  }));
  const duplicateFor = (candidate: EmployerDiscoveryResult) => {
    const reliable = enrichedEmployers.find((employer) => employer.sourceProvider === 'companies_house' && employer.sourceIdentity === candidate.sourceIdentity);
    if (reliable) return { reliable: true, label: `Already saved as ${reliable.displayName}.` };
    const uncertain = enrichedEmployers.find((employer) => normalized(employer.displayName) === normalized(candidate.name) ||
      Boolean(employer.sourceAddress && candidate.address && normalized(employer.sourceAddress) === normalized(candidate.address)));
    return uncertain ? { reliable: false, label: `Possible match with ${uncertain.displayName}; review before saving. No records will be merged.` } : null;
  };

  if (!canMaintain) return <p className="text-sm text-neutral-600">Employer discovery and engagement are available only to authorised Employment Specialists and programme managers.</p>;

  return <div className="space-y-5" aria-label="Employer discovery and engagement">
    {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>}
    {message && <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">{message}</div>}
    {(pendingSearch || pendingSave || pendingDraft) && <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
      <p>An earlier request is not confirmed. Other changes are paused until the exact retained request is retried.</p>
      {pendingSearch && <button className="btn-secondary mt-2" disabled={busy} onClick={() => void runSearch(pendingSearch)}>Retry exact employer search</button>}
      {pendingSave && <button className="btn-secondary mt-2" disabled={busy} onClick={() => void retainAndSave(pendingSave, 'The retained employer engagement change was confirmed.')}>Retry exact saved change</button>}
      {pendingDraft && <button className="btn-secondary mt-2" disabled={busy} onClick={() => void runDraft(pendingDraft)}>Retry exact draft request</button>}
    </div>}

    <section className="rounded-lg border p-4" aria-labelledby="find-employers-heading">
      <h3 id="find-employers-heading" className="text-lg font-semibold">Find employers</h3>
      <p className="mt-1 text-sm text-neutral-600">Search Companies House registry evidence within the selected programme. This is separate from advertised Job opportunities.</p>
      <p className="mt-1 text-sm text-neutral-600">Royal Mail/postal delivery and Post Office branch roles are separate filters. Registered-office evidence does not prove a local branch, workplace or vacancy.</p>
      {discoveryAvailability && !discoveryAvailability.available && <div role="status" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        Employer discovery is unavailable. Configure a server-side <code>COMPANIES_HOUSE_API_KEY</code> and set <code>REV_PROGRAMME_EMPLOYER_DISCOVERY_ENABLED=true</code>. Manual employer entry remains available below.
      </div>}
      <form className="mt-3 space-y-3" onSubmit={(event) => {
        event.preventDefault();
        void runSearch({ workspaceId, programmeId: programme.id, requestId: crypto.randomUUID(), filters });
      }}>
        <label className="block text-sm font-medium">Search geography
          <input className={fieldClass} value={filters.location} onChange={(event) => setFilters({ ...filters, location: event.target.value })} disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft} />
        </label>
        <fieldset className="grid gap-2 md:grid-cols-2"><legend className="text-sm font-medium">Employer sectors</legend>
          {employerDiscoverySectors.map(([key, label]) => <label key={key} className="flex gap-2 text-sm">
            <input type="checkbox" checked={filters.sectors.includes(key)} disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft}
              onChange={(event) => setFilters({ ...filters, sectors: event.target.checked ? [...filters.sectors, key] : filters.sectors.filter((item) => item !== key) })} />
            {label}
          </label>)}
        </fieldset>
        <label className="block text-sm font-medium">Exclude employer-name terms
          <input className={fieldClass} value={filters.excludeTerms.join(', ')} onChange={(event) => setFilters({ ...filters, excludeTerms: split(event.target.value) })} disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft} />
          <span className="block text-xs text-neutral-600">Editable pilot default: barbering.</span>
        </label>
        <button className="btn-primary" disabled={busy || !discoveryAvailability?.available || filters.sectors.length === 0 || !!pendingSearch || !!pendingSave || !!pendingDraft}>SEARCH COMPANIES HOUSE</button>
      </form>
      {!ready && <p className="mt-3 text-sm">Loading employer discovery…</p>}
      {ready && results.length === 0 && <p className="mt-3 text-sm text-neutral-600">No discovery results are ready for review. Manual employer entry remains available.</p>}
      <div className="mt-4 space-y-3">{results.map((candidate) => {
        const duplicate = duplicateFor(candidate);
        return <article key={candidate.sourceIdentity} className="rounded border p-3">
          <h4 className="font-semibold">{candidate.name}</h4>
          <p className="text-sm">{candidate.sector || 'Sector unknown'} · {candidate.location || 'Location unknown'}</p>
          <p className="text-sm text-neutral-600">{candidate.address || 'Registered-office address unknown'}</p>
          <p className="text-xs text-neutral-600">Retrieved {new Date(candidate.retrievedAt).toLocaleString()} · <a className="underline" href={candidate.sourceUrl} target="_blank" rel="noreferrer">Open Companies House source</a></p>
          <ul className="mt-2 space-y-1 text-sm">{candidate.evidence.map((item) => <li key={`${item.kind}:${item.label}`}>
            <strong>{item.kind === 'verified_fact' ? 'Verified fact' : item.kind === 'unknown' ? 'Unknown' : 'AI suggestion'} — {item.label}:</strong> {item.value}
          </li>)}</ul>
          {duplicate && <p className={`mt-2 text-sm ${duplicate.reliable ? 'text-green-800' : 'text-amber-800'}`}>{duplicate.label}</p>}
          <button className="btn-secondary mt-2" disabled={busy || duplicate?.reliable || !!pendingSearch || !!pendingSave || !!pendingDraft}
            onClick={() => void retainAndSave({
              operation: 'discovery_employer', workspaceId, programmeId: programme.id, recordId: null,
              requestId: crypto.randomUUID(), expectedVersion: 0,
              payload: { searchId: data.searches.find((search) => search.results?.some((item) => item.sourceIdentity === candidate.sourceIdentity))?.searchId, sourceIdentity: candidate.sourceIdentity },
            }, `${candidate.name} was saved to ${programme.name} for review.`)}>SAVE EMPLOYER TO PROGRAMME</button>
        </article>;
      })}</div>
      <p className="mt-3 text-xs text-neutral-600">Contains public sector information licensed under the Open Government Licence v3.0.</p>
    </section>

    <section className="rounded-lg border p-4" aria-labelledby="engagement-workspace-heading">
      <h3 id="engagement-workspace-heading" className="text-lg font-semibold">Employer engagement workspace</h3>
      <p className="mt-1 text-sm text-neutral-600">Manual contact records are not messages sent by REV. No sending, scheduling or automatic follow-up is enabled.</p>
      {employers.length === 0 ? <p className="mt-3 text-sm text-neutral-600">Add or save an employer to start an engagement record.</p> : <>
        <label className="mt-3 block text-sm font-medium">Employer
          <select className={fieldClass} value={selectedEmployerId} onChange={(event) => setSelectedEmployerId(event.target.value)}>
            {employers.map((employer) => <option key={employer.id} value={employer.id}>{employer.displayName}</option>)}
          </select>
        </label>
        {selectedEmployer && <div className="mt-4 space-y-4">
          <div><h4 className="font-semibold">{selectedEmployer.displayName}</h4>
            <p className="text-sm">{selectedEmployer.sectorKey ?? 'Sector unknown'} · {selectedEmployer.primaryGeographyKey ?? 'Location unknown'}</p>
            <h5 className="mt-2 font-medium">Employer contacts</h5>
            {selectedContacts.length ? <ul className="text-sm">{selectedContacts.map((contact) => <li key={contact.id}>{contact.preferredName}{contact.roleTitle ? ` — ${contact.roleTitle}` : ''}{contact.suppressed ? ' — Suppressed' : ''}</li>)}</ul> : <p className="text-sm text-neutral-600">No employer contacts recorded.</p>}
          </div>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(event: FormEvent) => {
            event.preventDefault();
            void retainAndSave({
              operation: 'engagement', workspaceId, programmeId: programme.id,
              recordId: selectedEngagement?.id ?? null, requestId: crypto.randomUUID(),
              expectedVersion: selectedEngagement?.version ?? 0,
              payload: { employerId: selectedEmployer.id, ...engagementDraft },
            }, 'Employer engagement plan saved.');
          }}>
            <label className="text-sm font-medium">Engagement stage<select className={fieldClass} value={engagementDraft.stage} onChange={(event) => setEngagementDraft({ ...engagementDraft, stage: event.target.value })}>{employerEngagementStages.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label className="text-sm font-medium">Responsible Employment Specialist<select className={fieldClass} value={engagementDraft.responsibleAdviserUserId} onChange={(event) => setEngagementDraft({ ...engagementDraft, responsibleAdviserUserId: event.target.value })}><option value="">Not assigned</option>{activeAdvisers.map((adviser) => <option key={adviser.id} value={adviser.userId}>{adviser.label}</option>)}</select></label>
            <label className="text-sm font-medium">Next action<input className={fieldClass} value={engagementDraft.nextAction} onChange={(event) => setEngagementDraft({ ...engagementDraft, nextAction: event.target.value })} /></label>
            <label className="text-sm font-medium">Follow-up date<input type="date" className={fieldClass} value={engagementDraft.followUpDate} onChange={(event) => setEngagementDraft({ ...engagementDraft, followUpDate: event.target.value })} /></label>
            <button className="btn-primary md:col-span-2" disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft}>SAVE ENGAGEMENT PLAN</button>
          </form>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(event) => {
            event.preventDefault();
            void retainAndSave({
              operation: 'engagement_event', workspaceId, programmeId: programme.id, recordId: null,
              requestId: crypto.randomUUID(), expectedVersion: 0,
              payload: { employerId: selectedEmployer.id, ...historyDraft },
            }, 'Engagement history added as a manual record. Nothing was sent by REV.');
          }}>
            <h5 className="font-medium md:col-span-2">Record engagement history</h5>
            <label className="text-sm font-medium">Record type<select className={fieldClass} value={historyDraft.eventType} onChange={(event) => setHistoryDraft({ ...historyDraft, eventType: event.target.value })}><option value="manual_contact">Manually recorded contact</option><option value="note">Engagement note</option></select></label>
            <label className="text-sm font-medium">Contact<select className={fieldClass} value={historyDraft.contactId} onChange={(event) => setHistoryDraft({ ...historyDraft, contactId: event.target.value })}><option value="">No named contact</option>{selectedContacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.preferredName}{contact.suppressed ? ' — suppressed' : ''}</option>)}</select></label>
            <label className="text-sm font-medium">Channel<select className={fieldClass} value={historyDraft.channel} onChange={(event) => setHistoryDraft({ ...historyDraft, channel: event.target.value })}><option value="email">Email</option><option value="phone">Phone</option><option value="meeting">Meeting</option><option value="in_person">In person</option><option value="other">Other</option></select></label>
            <label className="text-sm font-medium">What happened<textarea required className={fieldClass} value={historyDraft.summary} onChange={(event) => setHistoryDraft({ ...historyDraft, summary: event.target.value })} /></label>
            <button className="btn-secondary md:col-span-2" disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft}>ADD MANUAL HISTORY</button>
          </form>
          <div><h5 className="font-medium">Engagement history</h5>{selectedEvents.length ? <ol className="mt-2 space-y-2">{selectedEvents.map((item) => <li key={item.id} className="rounded bg-neutral-50 p-2 text-sm"><strong>{item.origin === 'manual' ? 'Manually recorded' : 'Prepared by REV — not sent'}</strong> · {new Date(item.createdAt).toLocaleString()}<br />{item.summary}</li>)}</ol> : <p className="text-sm text-neutral-600">No engagement history recorded.</p>}</div>
        </div>}
      </>}
    </section>

    <section className="rounded-lg border p-4" aria-labelledby="prepare-outreach-heading">
      <h3 id="prepare-outreach-heading" className="text-lg font-semibold">Prepare employer outreach</h3>
      <p className="mt-1 font-medium">Prepared — not sent</p>
      <p className="text-sm text-neutral-600">Drafts use saved employer evidence and the programme offer. They contain no Service user information and require Employment Specialist review.</p>
      {isManager && <form className="mt-3 space-y-2" onSubmit={(event) => {
        event.preventDefault();
        void retainAndSave({
          operation: 'outreach_settings', workspaceId, programmeId: programme.id,
          recordId: data.settings?.id ?? null, requestId: crypto.randomUUID(),
          expectedVersion: data.settings?.version ?? 0, payload: { offerSummary },
        }, 'Programme offer summary saved.');
      }}>
        <label className="block text-sm font-medium">Programme offer for employer outreach<textarea className={fieldClass} minLength={20} maxLength={2000} required value={offerSummary} onChange={(event) => setOfferSummary(event.target.value)} /></label>
        <button className="btn-secondary" disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft}>SAVE PROGRAMME OFFER</button>
      </form>}
      {outreachAvailability && !outreachAvailability.available && <div role="status" className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        AI draft preparation is unavailable. Configure server-side <code>OPENAI_API_KEY</code>, set <code>REV_PROGRAMME_EMPLOYER_OUTREACH_AI_ENABLED=true</code>, and optionally set <code>REV_PROGRAMME_EMPLOYER_OUTREACH_DAILY_LIMIT</code> (default 10, maximum 50). No browser key or fallback draft is used.
      </div>}
      {selectedEmployer && <div className="mt-3 space-y-3">
        <label className="block text-sm font-medium">Employer contact for the draft<select className={fieldClass} value={draftContactId} onChange={(event) => setDraftContactId(event.target.value)}><option value="">No named contact</option>{selectedContacts.map((contact) => <option key={contact.id} value={contact.id} disabled={contact.suppressed}>{contact.preferredName}{contact.suppressed ? ' — suppressed' : ''}</option>)}</select></label>
        <button className="btn-primary" disabled={busy || !outreachAvailability?.available || !data.settings || !programme.brandingName || !programme.senderDisplayName || !programme.senderReplyTo || !selectedEmployer.sourceEvidence || !!pendingSearch || !!pendingSave || !!pendingDraft}
          onClick={() => {
            const contact = selectedContacts.find((item) => item.id === draftContactId) ?? null;
            void runDraft({
              workspaceId, programmeId: programme.id, employerId: selectedEmployer.id,
              contactId: contact?.id ?? null, requestId: crypto.randomUUID(),
              employerVersion: selectedEmployer.version, settingsVersion: data.settings?.version ?? 0,
              contactVersion: contact?.version ?? null,
            });
          }}>PREPARE DRAFT FOR REVIEW</button>
        {(!data.settings || !programme.brandingName || !programme.senderDisplayName || !programme.senderReplyTo || !selectedEmployer.sourceEvidence) && <p className="text-sm text-amber-800">Draft preparation needs the programme offer, branding, sender identity and verified employer source evidence.</p>}
        {draftEdit.draftId ? <form className="space-y-2" onSubmit={(event) => {
          event.preventDefault();
          void retainAndSave({
            operation: 'draft_revision', workspaceId, programmeId: programme.id,
            recordId: draftEdit.draftId, requestId: crypto.randomUUID(), expectedVersion: draftEdit.revision,
            payload: { subject: draftEdit.subject, body: draftEdit.body },
          }, 'Outreach draft revision saved. Nothing was sent.');
        }}>
          <p className="rounded border border-blue-300 bg-blue-50 p-2 text-sm"><strong>Prepared — not sent.</strong> Review and edit before any separately authorised future sending workflow.</p>
          <label className="block text-sm font-medium">Subject<input className={fieldClass} value={draftEdit.subject} onChange={(event) => setDraftEdit({ ...draftEdit, subject: event.target.value })} /></label>
          <label className="block text-sm font-medium">Email body<textarea className={fieldClass} rows={9} value={draftEdit.body} onChange={(event) => setDraftEdit({ ...draftEdit, body: event.target.value })} /></label>
          <button className="btn-secondary" disabled={busy || !!pendingSearch || !!pendingSave || !!pendingDraft}>SAVE REVIEWED DRAFT</button>
        </form> : <p className="text-sm text-neutral-600">No outreach draft has been prepared for this employer.</p>}
      </div>}
    </section>
    <section className="rounded-lg border border-dashed p-4 text-sm text-neutral-600">
      <h3 className="font-semibold text-neutral-900">Planned next slices</h3>
      <p>Job fairs and events, Service user job matching, and applications remain separate future work. This workflow does not perform them.</p>
    </section>
  </div>;
}

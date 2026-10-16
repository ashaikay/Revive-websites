import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import type { ProgrammeHubSaveAttempt } from '@/domain/programmeHub';
import { emptyParticipantContact, normaliseParticipantContact, participantContactColumns, participantContactError, parseParticipantContact, type ParticipantContactDraft, type ParticipantContactRecord } from '@/services/programmeParticipantContacts';

export function ParticipantContactDetails({ workspaceId, programmeId, participantId, openRequest, refreshKey, busy, pending, feedback, onSave, onEditingChange }: {
  workspaceId: string; programmeId: string; participantId: string; openRequest: number; refreshKey: number;
  busy: boolean; pending: ProgrammeHubSaveAttempt | null; feedback: React.ReactNode;
  onEditingChange?: (editing: boolean) => void;
  onSave: (record: ParticipantContactRecord | null, draft: ParticipantContactDraft) => Promise<boolean>;
}) {
  const [opened, setOpened] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [record, setRecord] = useState<ParticipantContactRecord | null>(null);
  const [draft, setDraft] = useState<ParticipantContactDraft>(emptyParticipantContact);
  const [editing, setEditing] = useState(false);
  useEffect(() => { onEditingChange?.(editing); }, [editing, onEditingChange]);
  useEffect(() => () => onEditingChange?.(false), [onEditingChange]);
  const [error, setError] = useState('');
  const [validation, setValidation] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const pendingRef = useRef<ProgrammeHubSaveAttempt | null>(null);
  const relevantPending = pending?.operation === 'participant_contact' && pending.programmeId === programmeId && pending.payload.participantId === participantId ? pending : null;
  pendingRef.current = relevantPending;
  useEffect(() => { if (openRequest || relevantPending) setOpened(true); }, [openRequest, relevantPending]);
  useEffect(() => {
    if (!opened) return;
    const current = ++generation.current;
    let active = true;
    setLoaded(false); setError('');
    void (async () => {
      if (!supabaseClient) throw new Error('Contact details could not be loaded.');
      const response = await supabaseClient.from('programme_hub_participant_contacts').select(participantContactColumns)
        .eq('workspace_id', workspaceId).eq('programme_id', programmeId).eq('participant_id', participantId);
      if (response.error) throw new Error('Contact details are unavailable.');
      const saved = parseParticipantContact(response.data, workspaceId, programmeId, participantId);
      if (!active || generation.current !== current) return;
      setRecord(saved); setLoaded(true);
      const retained = pendingRef.current;
      if (retained) {
        const p = retained.payload;
        setDraft({ phone: String(p.phone ?? ''), email: String(p.email ?? ''), addressLine1: String(p.addressLine1 ?? ''), addressLine2: String(p.addressLine2 ?? ''), town: String(p.town ?? ''), postcode: String(p.postcode ?? '') });
        setEditing(true);
      } else { setDraft(saved ?? emptyParticipantContact); setEditing(false); }
    })().catch((failure: unknown) => {
      if (active && generation.current === current) { setError(failure instanceof Error ? failure.message : 'Contact details could not be loaded.'); setLoaded(true); }
    });
    return () => { active = false; };
  }, [opened, workspaceId, programmeId, participantId, refreshKey, reload]);
  useEffect(() => {
    if (!relevantPending) return;
    const payload = relevantPending.payload;
    setDraft({ phone: String(payload.phone ?? ''), email: String(payload.email ?? ''), addressLine1: String(payload.addressLine1 ?? ''), addressLine2: String(payload.addressLine2 ?? ''), town: String(payload.town ?? ''), postcode: String(payload.postcode ?? '') });
    setEditing(true);
  }, [relevantPending]);
  const fields: Array<[keyof ParticipantContactDraft, string, number]> = [['phone','Phone number',40],['email','Email address',320],['addressLine1','Address line 1',200],['addressLine2','Address line 2',200],['town','Town or city',120],['postcode','UK postcode',8]];
  return <details className="mt-4 border-t border-neutral-200 pt-4" open={opened || !!relevantPending} onToggle={(event) => {
    if (!event.currentTarget.open && (editing || relevantPending)) event.currentTarget.open = true;
    setOpened(event.currentTarget.open);
  }}>
    <summary className="cursor-pointer font-medium">Contact details</summary>
    {!loaded && <p className="mt-2 text-sm">Loading contact details...</p>}
    {error && <div className="mt-2 text-sm" role="alert">{error}<button type="button" className="btn-secondary ml-2" onClick={() => setReload((value) => value + 1)}>Retry loading</button></div>}
    {loaded && !error && !editing && <div className="mt-3">
      {record ? <dl className="grid gap-3 text-sm sm:grid-cols-2">{fields.map(([field, label]) => <div key={field}><dt className="font-medium">{label}</dt><dd className="break-words text-neutral-600">{record[field] || 'Not added'}</dd></div>)}</dl> : <p className="text-sm text-neutral-600">No contact details added.</p>}
      <button type="button" className="btn-secondary mt-3" disabled={busy} onClick={() => { setDraft(record ?? emptyParticipantContact); setEditing(true); setValidation(''); }}>{record ? 'Edit contact details' : 'Add contact details'}</button>
    </div>}
    {loaded && !error && editing && <form className="mt-3 grid gap-3 sm:grid-cols-2" noValidate onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      const values = normaliseParticipantContact(draft);
      const problem = participantContactError(values);
      if (problem) { setValidation(problem); return; }
      setValidation(''); setDraft(values);
      void onSave(record, values).then((confirmed) => { if (confirmed) { setEditing(false); setReload((value) => value + 1); } });
    }}>
      {fields.map(([field,label,max]) => <label key={field} className="block text-sm font-medium">{label}<input className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2" type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'} maxLength={field === 'postcode' ? 16 : max} disabled={busy} value={draft[field]} onChange={(event) => setDraft({ ...draft, [field]: event.target.value })} /></label>)}
      <p className="col-span-full text-sm text-neutral-600">All fields are optional. A postcode does not confirm programme eligibility.</p>
      {validation && <p role="alert" className="col-span-full text-sm text-red-800">{validation}</p>}
      <div className="col-span-full flex gap-2"><button className="btn-primary" disabled={busy}>{relevantPending && busy ? 'Saving...' : 'Save contact details'}</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => { setEditing(false); setValidation(''); setReload((value) => value + 1); }}>Cancel</button></div>
    </form>}
    {feedback}
  </details>;
}

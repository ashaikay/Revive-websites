import { Children, FormEvent, useEffect, useMemo, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import type {
  ProgrammeHubData,
  ProgrammeHubEmployer,
  ProgrammeHubEmployerContact,
  ProgrammeHubParticipant,
  ProgrammeHubParticipantNote,
  ProgrammeHubProgramme,
  ProgrammeHubSaveAttempt,
  ProgrammeHubVacancy,
} from '@/domain/programmeHub';
import { programmeNeedsReview } from '@/domain/programmeHub';
import {
  clearProgrammeHubAttempt,
  loadProgrammeHubData,
  loadProgrammeHubParticipantNotes,
  rememberProgrammeHubAttempt,
  restoreProgrammeHubAttempt,
  submitProgrammeHubAttempt,
} from '@/services/programmeHubService';

const emptyData: ProgrammeHubData = {
  programmes: [], advisers: [], employers: [], contacts: [], vacancies: [],
  participants: [], participantAdvisers: [], participantNotes: [], contracts: [], members: [],
};
const splitKeys = (value: string) => [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].sort();
const joinKeys = (value: string[]) => value.join(', ');
const inputClass = 'w-full rounded-md border border-neutral-300 px-3 py-2';
const blankProgramme = { name: '', timezone: 'Europe/London', brandingName: '', senderDisplayName: '', senderReplyTo: '', active: true };
const blankEmployer = { employerKey: '', displayName: '', sectorKey: '', primaryGeographyKey: '', active: true };
const blankContact = { employerId: '', contactKey: '', preferredName: '', roleTitle: '', businessEmail: '', businessPhone: '', suppressed: false, suppressionReasonKey: '', active: true };
const blankVacancy = { employerId: '', employerContactId: '', vacancyKey: '', title: '', workGeographyKey: '', requiredSkillKeys: '', desiredSkillKeys: '', active: true };
const blankParticipant = { participantKey: '', preferredName: '', caseReference: '', desiredRoleKeys: '', skillKeys: '', vacancySearchGeographyKeys: '', residencyEvidenceReference: '', active: true };

export function ProgrammeHubModule({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const [data, setData] = useState<ProgrammeHubData>(emptyData);
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<ProgrammeHubSaveAttempt | null>(null);
  const [programmeEdit, setProgrammeEdit] = useState<ProgrammeHubProgramme | null>(null);
  const [programmeDraft, setProgrammeDraft] = useState(blankProgramme);
  const [employerEdit, setEmployerEdit] = useState<ProgrammeHubEmployer | null>(null);
  const [employerDraft, setEmployerDraft] = useState(blankEmployer);
  const [contactEdit, setContactEdit] = useState<ProgrammeHubEmployerContact | null>(null);
  const [contactDraft, setContactDraft] = useState(blankContact);
  const [vacancyEdit, setVacancyEdit] = useState<ProgrammeHubVacancy | null>(null);
  const [vacancyDraft, setVacancyDraft] = useState(blankVacancy);
  const [participantEdit, setParticipantEdit] = useState<ProgrammeHubParticipant | null>(null);
  const [participantDraft, setParticipantDraft] = useState(blankParticipant);
  const [adviserUserId, setAdviserUserId] = useState('');
  const [assignmentParticipantId, setAssignmentParticipantId] = useState('');
  const [assignmentAdviserId, setAssignmentAdviserId] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [notesReady, setNotesReady] = useState(false);
  const [notesError, setNotesError] = useState('');

  const readGateway = useMemo(() => ({
    read: async (table: string, columns: string, ws: string) => {
      if (!supabaseClient) throw new Error('Programme Hub is unavailable.');
      const { data: rows, error: readError } = await supabaseClient.from(table).select(columns).eq('workspace_id', ws);
      if (readError) throw new Error('Programme Hub could not be loaded.');
      return rows;
    },
  }), []);

  const load = async () => {
    const loaded = await loadProgrammeHubData(workspaceId, readGateway);
    setData((current) => ({ ...loaded, participantNotes: current.participantNotes }));
    setSelectedProgrammeId((current) => loaded.programmes.some((programme) => programme.id === current)
      ? current
      : loaded.programmes.find((programme) => programme.active)?.id ?? loaded.programmes[0]?.id ?? '');
    setReady(true);
  };

  useEffect(() => {
    let active = true;
    setReady(false);
    setError('');
    try {
      setPending(restoreProgrammeHubAttempt(window.sessionStorage, workspaceId, userId));
    } catch {
      setError('A retained Programme Hub save could not be read. Contact support before making another change.');
    }
    void load().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Programme Hub could not be loaded.');
    });
    return () => { active = false; };
  }, [workspaceId, userId]);

  useEffect(() => {
    let active = true;
    setNotesReady(false);
    setNotesError('');
    setData((current) => ({ ...current, participantNotes: [] }));
    if (!selectedProgrammeId) {
      setNotesReady(true);
      return () => { active = false; };
    }
    void loadProgrammeHubParticipantNotes(workspaceId, readGateway)
      .then((notes) => {
        if (!active) return;
        setData((current) => ({
          ...current,
          participantNotes: notes.filter((note) => note.programmeId === selectedProgrammeId),
        }));
        setNotesReady(true);
      })
      .catch(() => {
        if (!active) return;
        setNotesError('Participant notes are unavailable until the reviewed database migration and trusted function update are applied.');
        setNotesReady(true);
      });
    return () => { active = false; };
  }, [readGateway, selectedProgrammeId, workspaceId]);

  const membership = data.members.find((member) => member.userId === userId && member.status === 'active');
  const isManager = membership?.role === 'owner' || membership?.role === 'admin';
  const selectedProgramme = data.programmes.find((programme) => programme.id === selectedProgrammeId) ?? null;
  const isAdviser = data.advisers.some((adviser) => adviser.programmeId === selectedProgrammeId && adviser.userId === userId && adviser.active);
  const canMaintainEmployerRecords = isManager || isAdviser;
  const programmeEmployers = data.employers.filter((item) => item.programmeId === selectedProgrammeId);
  const programmeContacts = data.contacts.filter((item) => item.programmeId === selectedProgrammeId);
  const programmeVacancies = data.vacancies.filter((item) => item.programmeId === selectedProgrammeId);
  const programmeParticipants = data.participants.filter((item) => item.programmeId === selectedProgrammeId);
  const programmeAdvisers = data.advisers.filter((item) => item.programmeId === selectedProgrammeId);
  const programmeNotes = data.participantNotes.filter((item) => item.programmeId === selectedProgrammeId);

  const saveAttempt = async (attempt: ProgrammeHubSaveAttempt, success: string): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError('');
    setMessage('');
    rememberProgrammeHubAttempt(window.sessionStorage, userId, attempt);
    setPending(attempt);
    try {
      const client = supabaseClient;
      if (!client) throw new Error('Programme Hub is unavailable.');
      await submitProgrammeHubAttempt(attempt, {
        invoke: async (name, body) => {
          const { data: responseData, error: invokeError } = await client.functions.invoke(name, { body });
          if (invokeError) throw new Error('Save not confirmed. Keep this page open and retry the same change.');
          return { status: 200, data: responseData };
        },
      });
      clearProgrammeHubAttempt(window.sessionStorage, workspaceId, userId);
      setPending(null);
      await load();
      setMessage(success);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Save not confirmed. Keep this page open and retry the same change.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const attempt = (operation: ProgrammeHubSaveAttempt['operation'], programmeId: string | null, recordId: string | null, expectedVersion: number, payload: Record<string, unknown>): ProgrammeHubSaveAttempt => ({
    operation, workspaceId, programmeId, recordId, requestId: crypto.randomUUID(), expectedVersion, payload,
  });

  const retryPending = () => {
    if (!pending) return;
    const retained = pending;
    void saveAttempt(retained, 'The retained Programme Hub change was confirmed.').then(async (confirmed) => {
      if (!confirmed || retained.operation !== 'participant_note') return;
      const participantId = retained.payload.participantId;
      if (typeof participantId === 'string') {
        setNoteDrafts((current) => ({ ...current, [participantId]: '' }));
      }
      try {
        const notes = await loadProgrammeHubParticipantNotes(workspaceId, readGateway);
        setData((current) => ({
          ...current,
          participantNotes: notes.filter((note) => note.programmeId === selectedProgrammeId),
        }));
      } catch {
        setNotesError('The note was confirmed, but the timeline could not be refreshed. Refresh the page before adding another note.');
      }
    });
  };
  const resetProgramme = () => { setProgrammeEdit(null); setProgrammeDraft(blankProgramme); };
  const resetEmployer = () => { setEmployerEdit(null); setEmployerDraft(blankEmployer); };
  const resetContact = () => { setContactEdit(null); setContactDraft({ ...blankContact, employerId: programmeEmployers[0]?.id ?? '' }); };
  const resetVacancy = () => { setVacancyEdit(null); setVacancyDraft({ ...blankVacancy, employerId: programmeEmployers[0]?.id ?? '' }); };
  const resetParticipant = () => { setParticipantEdit(null); setParticipantDraft(blankParticipant); };
  const selectProgramme = (programmeId: string) => {
    setSelectedProgrammeId(programmeId);
    resetEmployer();
    setContactEdit(null);
    setContactDraft(blankContact);
    setVacancyEdit(null);
    setVacancyDraft(blankVacancy);
    resetParticipant();
    setAssignmentParticipantId('');
    setAssignmentAdviserId('');
    setNoteDrafts({});
    setMessage('');
  };

  const saveProgramme = (event: FormEvent) => {
    event.preventDefault();
    void saveAttempt(
      attempt('programme', null, programmeEdit?.id ?? null, programmeEdit?.version ?? 0, programmeDraft),
      programmeEdit ? 'Programme configuration updated.' : 'Programme created.',
    ).then((confirmed) => { if (confirmed) resetProgramme(); });
  };
  const saveEmployer = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    void saveAttempt(
      attempt('employer', selectedProgramme.id, employerEdit?.id ?? null, employerEdit?.version ?? 0, employerDraft),
      employerEdit ? 'Employer updated.' : 'Employer created.',
    ).then((confirmed) => { if (confirmed) resetEmployer(); });
  };
  const saveContact = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    void saveAttempt(
      attempt('contact', selectedProgramme.id, contactEdit?.id ?? null, contactEdit?.version ?? 0, contactDraft),
      contactEdit ? 'Employer contact updated.' : 'Employer contact created.',
    ).then((confirmed) => { if (confirmed) resetContact(); });
  };
  const saveVacancy = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    const payload = { ...vacancyDraft, requiredSkillKeys: splitKeys(vacancyDraft.requiredSkillKeys), desiredSkillKeys: splitKeys(vacancyDraft.desiredSkillKeys) };
    void saveAttempt(
      attempt('vacancy', selectedProgramme.id, vacancyEdit?.id ?? null, vacancyEdit?.version ?? 0, payload),
      vacancyEdit ? 'Vacancy updated.' : 'Vacancy created.',
    ).then((confirmed) => { if (confirmed) resetVacancy(); });
  };
  const saveParticipant = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    const payload = {
      ...participantDraft,
      desiredRoleKeys: splitKeys(participantDraft.desiredRoleKeys),
      skillKeys: splitKeys(participantDraft.skillKeys),
      vacancySearchGeographyKeys: splitKeys(participantDraft.vacancySearchGeographyKeys),
    };
    void saveAttempt(
      attempt('participant', selectedProgramme.id, participantEdit?.id ?? null, participantEdit?.version ?? 0, payload),
      participantEdit ? 'Participant employment profile updated.' : 'Participant employment profile created.',
    ).then((confirmed) => { if (confirmed) resetParticipant(); });
  };
  const saveParticipantNote = (participant: ProgrammeHubParticipant) => {
    if (!selectedProgramme) return;
    const body = noteDrafts[participant.id]?.trim() ?? '';
    if (!body) {
      setError('Enter a participant note before saving.');
      return;
    }
    void saveAttempt(
      attempt('participant_note', selectedProgramme.id, null, 0, { participantId: participant.id, body }),
      `Note added to ${participant.preferredName}'s programme record.`,
    ).then(async (confirmed) => {
      if (!confirmed) return;
      setNoteDrafts((current) => ({ ...current, [participant.id]: '' }));
      try {
        const notes = await loadProgrammeHubParticipantNotes(workspaceId, readGateway);
        setData((current) => ({ ...current, participantNotes: notes.filter((note) => note.programmeId === selectedProgramme.id) }));
      } catch {
        setNotesError('The note was saved, but the timeline could not be refreshed. Refresh the page before adding another note.');
      }
    });
  };

  const editProgramme = (programme: ProgrammeHubProgramme) => {
    setProgrammeEdit(programme);
    setProgrammeDraft({ name: programme.name, timezone: programme.timezone, brandingName: programme.brandingName ?? '', senderDisplayName: programme.senderDisplayName ?? '', senderReplyTo: programme.senderReplyTo ?? '', active: programme.active });
  };
  const editEmployer = (employer: ProgrammeHubEmployer) => {
    setEmployerEdit(employer);
    setEmployerDraft({ employerKey: employer.employerKey, displayName: employer.displayName, sectorKey: employer.sectorKey ?? '', primaryGeographyKey: employer.primaryGeographyKey ?? '', active: employer.active });
  };
  const editContact = (contact: ProgrammeHubEmployerContact) => {
    setContactEdit(contact);
    setContactDraft({ employerId: contact.employerId, contactKey: contact.contactKey, preferredName: contact.preferredName, roleTitle: contact.roleTitle ?? '', businessEmail: contact.businessEmail ?? '', businessPhone: contact.businessPhone ?? '', suppressed: contact.suppressed, suppressionReasonKey: contact.suppressionReasonKey ?? '', active: contact.active });
  };
  const editVacancy = (vacancy: ProgrammeHubVacancy) => {
    setVacancyEdit(vacancy);
    setVacancyDraft({ employerId: vacancy.employerId, employerContactId: vacancy.employerContactId ?? '', vacancyKey: vacancy.vacancyKey, title: vacancy.title, workGeographyKey: vacancy.workGeographyKey ?? '', requiredSkillKeys: joinKeys(vacancy.requiredSkillKeys), desiredSkillKeys: joinKeys(vacancy.desiredSkillKeys), active: vacancy.active });
  };
  const editParticipant = (participant: ProgrammeHubParticipant) => {
    setParticipantEdit(participant);
    setParticipantDraft({ participantKey: participant.participantKey, preferredName: participant.preferredName, caseReference: participant.caseReference, desiredRoleKeys: joinKeys(participant.desiredRoleKeys), skillKeys: joinKeys(participant.skillKeys), vacancySearchGeographyKeys: joinKeys(participant.vacancySearchGeographyKeys), residencyEvidenceReference: participant.residencyEvidenceReference ?? '', active: participant.active });
  };

  if (!ready && !error) return <main className="p-8 text-neutral-600">Loading Outcomes / Programme Hub...</main>;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600">Outcomes / Programme Hub</p>
        <h1 className="mt-1 text-3xl font-bold text-neutral-900">Employer Engagement</h1>
        <p className="mt-2 max-w-3xl text-neutral-600">Tenant-neutral employment-support records. This is separate from commercial GROWTH leads and worker Scheduling.</p>
      </header>

      {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}{pending && <button className="btn-secondary ml-3" disabled={busy} onClick={retryPending}>{busy ? 'Retrying...' : 'Retry same change'}</button>}</div>}
      {message && <div role="status" className="rounded-md border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</div>}
      {pending && !error && <div role="status" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">A retained save must be confirmed before another change.<button className="btn-secondary ml-3" disabled={busy} onClick={retryPending}>{busy ? 'Retrying...' : 'Retry same change'}</button></div>}

      {isManager && (
        <details className="card p-5" open={data.programmes.length === 0}>
          <summary className="cursor-pointer font-semibold">Programme configuration</summary>
          <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={saveProgramme}>
            <Field label="Programme name"><input required className={inputClass} value={programmeDraft.name} onChange={(event) => setProgrammeDraft({ ...programmeDraft, name: event.target.value })} /></Field>
            <Field label="Timezone"><input required className={inputClass} value={programmeDraft.timezone} onChange={(event) => setProgrammeDraft({ ...programmeDraft, timezone: event.target.value })} /></Field>
            <Field label="Tenant branding name"><input className={inputClass} value={programmeDraft.brandingName} onChange={(event) => setProgrammeDraft({ ...programmeDraft, brandingName: event.target.value })} /></Field>
            <Field label="Sender display name"><input className={inputClass} value={programmeDraft.senderDisplayName} onChange={(event) => setProgrammeDraft({ ...programmeDraft, senderDisplayName: event.target.value })} /></Field>
            <Field label="Sender reply address"><input type="email" className={inputClass} value={programmeDraft.senderReplyTo} onChange={(event) => setProgrammeDraft({ ...programmeDraft, senderReplyTo: event.target.value })} /></Field>
            <div className="flex items-end gap-2"><button className="btn-primary" disabled={busy || !!pending}>{programmeEdit ? 'Save programme changes' : 'Create programme'}</button>{programmeEdit && <button type="button" className="btn-secondary" onClick={resetProgramme}>Cancel</button>}</div>
          </form>
          {data.programmes.length > 0 && <ul className="mt-4 space-y-2">{data.programmes.map((programme) => <li key={programme.id} className="flex items-center justify-between rounded border p-3"><span>{programme.name}</span><button className="btn-secondary" disabled={!!pending} onClick={() => editProgramme(programme)}>Edit</button></li>)}</ul>}
        </details>
      )}

      {data.programmes.length > 0 && (
        <section className="card border-primary-200 bg-primary-50 p-5" aria-label="Programme selection">
          <Field label="Choose a programme">
          <select className={inputClass} value={selectedProgrammeId} onChange={(event) => selectProgramme(event.target.value)}>
            {data.programmes.map((programme) => <option key={programme.id} value={programme.id}>{programme.name}</option>)}
          </select>
          </Field>
          {selectedProgramme && <p className="mt-3 text-sm text-neutral-700">You are viewing <strong>{selectedProgramme.name}</strong>. Records below belong only to this programme.</p>}
        </section>
      )}

      {selectedProgramme && <section className="space-y-3" aria-labelledby="overview-heading">
        <h2 id="overview-heading" className="text-xl font-semibold">Overview and setup</h2>
        <ConfigurationState programme={selectedProgramme} data={data} />
      </section>}

      {selectedProgramme && isManager && (
        <section className="card p-5" aria-labelledby="adviser-heading">
          <h2 id="adviser-heading" className="text-xl font-semibold">Advisers and caseload</h2>
          <p className="mt-1 text-sm text-neutral-600">Advisers can see programme employer records and only participant profiles assigned to their caseload.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <select aria-label="Workspace member" className={inputClass} value={adviserUserId} onChange={(event) => setAdviserUserId(event.target.value)}>
              <option value="">Select an active workspace member</option>
              {data.members.filter((member) => member.status === 'active' && !programmeAdvisers.some((adviser) => adviser.userId === member.userId && adviser.active)).map((member) => <option key={member.userId} value={member.userId}>{adviserLabel(member.userId, data, userId)}</option>)}
            </select>
            <button className="btn-primary" disabled={!adviserUserId || busy || !!pending} onClick={() => void saveAttempt(attempt('adviser', selectedProgramme.id, null, 0, { userId: adviserUserId, active: true }), 'Programme adviser added.').then((confirmed) => { if (confirmed) setAdviserUserId(''); })}>Add adviser</button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <select aria-label="Participant for caseload" className={inputClass} value={assignmentParticipantId} onChange={(event) => setAssignmentParticipantId(event.target.value)}>
              <option value="">Select participant</option>{programmeParticipants.map((participant) => <option key={participant.id} value={participant.id}>{participant.preferredName} - {participant.caseReference}</option>)}
            </select>
            <select aria-label="Adviser for caseload" className={inputClass} value={assignmentAdviserId} onChange={(event) => setAssignmentAdviserId(event.target.value)}>
              <option value="">Select adviser</option>{programmeAdvisers.filter((adviser) => adviser.active).map((adviser) => <option key={adviser.id} value={adviser.userId}>{adviserLabel(adviser.userId, data, userId)}</option>)}
            </select>
            <button className="btn-primary" disabled={!assignmentParticipantId || !assignmentAdviserId || busy || !!pending} onClick={() => void saveAttempt(attempt('participant_adviser', selectedProgramme.id, null, 0, { participantId: assignmentParticipantId, adviserUserId: assignmentAdviserId, active: true }), 'Participant assigned to adviser.').then((confirmed) => { if (confirmed) { setAssignmentParticipantId(''); setAssignmentAdviserId(''); } })}>Assign caseload</button>
          </div>
        </section>
      )}

      {selectedProgramme && canMaintainEmployerRecords && (
        <>
          <h2 className="text-xl font-semibold">Employers and contacts</h2>
          <RecordSection title="Employers" empty="No employers have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" onSubmit={saveEmployer}>
            <Field label="Employer reference (for example, EMP-001)"><input required className={inputClass} value={employerDraft.employerKey} onChange={(event) => setEmployerDraft({ ...employerDraft, employerKey: event.target.value })} /></Field>
            <Field label="Employer name"><input required className={inputClass} value={employerDraft.displayName} onChange={(event) => setEmployerDraft({ ...employerDraft, displayName: event.target.value })} /></Field>
            <Field label="Sector (for example, retail)"><input className={inputClass} value={employerDraft.sectorKey} onChange={(event) => setEmployerDraft({ ...employerDraft, sectorKey: event.target.value })} /></Field>
            <Field label="Primary work area reference"><input className={inputClass} value={employerDraft.primaryGeographyKey} onChange={(event) => setEmployerDraft({ ...employerDraft, primaryGeographyKey: event.target.value })} /></Field>
            <FormActions editing={!!employerEdit} busy={busy || !!pending} cancel={resetEmployer} />
          </form>}>
            {programmeEmployers.map((employer) => <RecordRow key={employer.id} title={employer.displayName} detail={employer.employerKey} edit={() => editEmployer(employer)} />)}
          </RecordSection>

          <RecordSection title="Employer contacts" empty="No employer contacts have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" onSubmit={saveContact}>
            <Field label="Employer"><select required className={inputClass} value={contactDraft.employerId} onChange={(event) => setContactDraft({ ...contactDraft, employerId: event.target.value })}><option value="">Select employer</option>{programmeEmployers.map((employer) => <option key={employer.id} value={employer.id}>{employer.displayName}</option>)}</select></Field>
            <Field label="Contact reference (for example, CONTACT-001)"><input required className={inputClass} value={contactDraft.contactKey} onChange={(event) => setContactDraft({ ...contactDraft, contactKey: event.target.value })} /></Field>
            <Field label="Preferred name"><input required className={inputClass} value={contactDraft.preferredName} onChange={(event) => setContactDraft({ ...contactDraft, preferredName: event.target.value })} /></Field>
            <Field label="Role title"><input className={inputClass} value={contactDraft.roleTitle} onChange={(event) => setContactDraft({ ...contactDraft, roleTitle: event.target.value })} /></Field>
            <Field label="Business email"><input type="email" className={inputClass} value={contactDraft.businessEmail} onChange={(event) => setContactDraft({ ...contactDraft, businessEmail: event.target.value })} /></Field>
            <Field label="Business phone"><input className={inputClass} value={contactDraft.businessPhone} onChange={(event) => setContactDraft({ ...contactDraft, businessPhone: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={contactDraft.suppressed} onChange={(event) => setContactDraft({ ...contactDraft, suppressed: event.target.checked })} />Suppress engagement preparation</label>
            {contactDraft.suppressed && <Field label="Reason for suppression"><input required className={inputClass} value={contactDraft.suppressionReasonKey} onChange={(event) => setContactDraft({ ...contactDraft, suppressionReasonKey: event.target.value })} /></Field>}
            <FormActions editing={!!contactEdit} busy={busy || !!pending} cancel={resetContact} />
          </form>}>
            {programmeContacts.map((contact) => <RecordRow key={contact.id} title={contact.preferredName} detail={`${programmeEmployers.find((employer) => employer.id === contact.employerId)?.displayName ?? 'Employer'}${contact.suppressed ? ' - Suppressed' : ''}`} edit={() => editContact(contact)} />)}
          </RecordSection>

          <RecordSection title="Vacancies" empty="No vacancies have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" onSubmit={saveVacancy}>
            <Field label="Employer"><select required className={inputClass} value={vacancyDraft.employerId} onChange={(event) => setVacancyDraft({ ...vacancyDraft, employerId: event.target.value, employerContactId: '' })}><option value="">Select employer</option>{programmeEmployers.map((employer) => <option key={employer.id} value={employer.id}>{employer.displayName}</option>)}</select></Field>
            <Field label="Employer contact"><select className={inputClass} value={vacancyDraft.employerContactId} onChange={(event) => setVacancyDraft({ ...vacancyDraft, employerContactId: event.target.value })}><option value="">No contact selected</option>{programmeContacts.filter((contact) => contact.employerId === vacancyDraft.employerId).map((contact) => <option key={contact.id} value={contact.id}>{contact.preferredName}</option>)}</select></Field>
            <Field label="Vacancy reference (for example, VAC-001)"><input required className={inputClass} value={vacancyDraft.vacancyKey} onChange={(event) => setVacancyDraft({ ...vacancyDraft, vacancyKey: event.target.value })} /></Field>
            <Field label="Vacancy title"><input required className={inputClass} value={vacancyDraft.title} onChange={(event) => setVacancyDraft({ ...vacancyDraft, title: event.target.value })} /></Field>
            <Field label="Work area reference"><input className={inputClass} value={vacancyDraft.workGeographyKey} onChange={(event) => setVacancyDraft({ ...vacancyDraft, workGeographyKey: event.target.value })} /></Field>
            <Field label="Required skills (comma separated)"><input className={inputClass} value={vacancyDraft.requiredSkillKeys} onChange={(event) => setVacancyDraft({ ...vacancyDraft, requiredSkillKeys: event.target.value })} /></Field>
            <Field label="Helpful skills (comma separated)"><input className={inputClass} value={vacancyDraft.desiredSkillKeys} onChange={(event) => setVacancyDraft({ ...vacancyDraft, desiredSkillKeys: event.target.value })} /></Field>
            <FormActions editing={!!vacancyEdit} busy={busy || !!pending} cancel={resetVacancy} />
          </form>}>
            {programmeVacancies.map((vacancy) => <RecordRow key={vacancy.id} title={vacancy.title} detail={vacancy.workGeographyKey ? `Work area: ${vacancy.workGeographyKey}` : 'Work area needs review'} edit={() => editVacancy(vacancy)} />)}
          </RecordSection>
        </>
      )}

      {selectedProgramme && isManager && (
        <RecordSection title="Participants" empty="No participants have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" onSubmit={saveParticipant}>
          <Field label="Participant reference (for example, PART-001)"><input required className={inputClass} value={participantDraft.participantKey} onChange={(event) => setParticipantDraft({ ...participantDraft, participantKey: event.target.value })} /></Field>
          <Field label="Preferred name"><input required className={inputClass} value={participantDraft.preferredName} onChange={(event) => setParticipantDraft({ ...participantDraft, preferredName: event.target.value })} /></Field>
          <Field label="Tenant case reference"><input required className={inputClass} value={participantDraft.caseReference} onChange={(event) => setParticipantDraft({ ...participantDraft, caseReference: event.target.value })} /></Field>
          <Field label="Desired roles (comma separated)"><input className={inputClass} value={participantDraft.desiredRoleKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, desiredRoleKeys: event.target.value })} /></Field>
          <Field label="Employment skills (comma separated)"><input className={inputClass} value={participantDraft.skillKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, skillKeys: event.target.value })} /></Field>
          <Field label="Vacancy search areas (comma separated)"><input className={inputClass} value={participantDraft.vacancySearchGeographyKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, vacancySearchGeographyKeys: event.target.value })} /></Field>
          <Field label="Residency evidence reference"><input className={inputClass} value={participantDraft.residencyEvidenceReference} onChange={(event) => setParticipantDraft({ ...participantDraft, residencyEvidenceReference: event.target.value })} /></Field>
          <FormActions editing={!!participantEdit} busy={busy || !!pending} cancel={resetParticipant} />
        </form>}>
          {programmeParticipants.map((participant) => <ParticipantRecord key={participant.id} participant={participant} notes={programmeNotes.filter((note) => note.participantId === participant.id)} programme={selectedProgramme} data={data} userId={userId} noteDraft={noteDrafts[participant.id] ?? ''} notesReady={notesReady} notesError={notesError} busy={busy || !!pending} edit={() => editParticipant(participant)} setNote={(body) => setNoteDrafts((current) => ({ ...current, [participant.id]: body }))} saveNote={() => saveParticipantNote(participant)} />)}
        </RecordSection>
      )}

      {selectedProgramme && isAdviser && !isManager && (
        <section className="card p-5">
          <h2 className="text-xl font-semibold">My assigned participants</h2>
          <div className="mt-3 space-y-3">{programmeParticipants.map((participant) => <ParticipantRecord key={participant.id} participant={participant} notes={programmeNotes.filter((note) => note.participantId === participant.id)} programme={selectedProgramme} data={data} userId={userId} noteDraft={noteDrafts[participant.id] ?? ''} notesReady={notesReady} notesError={notesError} busy={busy || !!pending} edit={() => editParticipant(participant)} setNote={(body) => setNoteDrafts((current) => ({ ...current, [participant.id]: body }))} saveNote={() => saveParticipantNote(participant)} />)}</div>
          {programmeParticipants.length === 0 && <p className="mt-3 text-sm text-neutral-600">No participants are currently assigned to your caseload in this programme.</p>}
          {participantEdit && <form className="mt-4 grid gap-3 md:grid-cols-2" onSubmit={saveParticipant}><Field label="Preferred name"><input required className={inputClass} value={participantDraft.preferredName} onChange={(event) => setParticipantDraft({ ...participantDraft, preferredName: event.target.value })} /></Field><Field label="Desired roles"><input className={inputClass} value={participantDraft.desiredRoleKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, desiredRoleKeys: event.target.value })} /></Field><Field label="Employment skills"><input className={inputClass} value={participantDraft.skillKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, skillKeys: event.target.value })} /></Field><Field label="Vacancy search areas"><input className={inputClass} value={participantDraft.vacancySearchGeographyKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, vacancySearchGeographyKeys: event.target.value })} /></Field><FormActions editing busy={busy || !!pending} cancel={resetParticipant} /></form>}
        </section>
      )}

      {!isManager && !isAdviser && ready && <div className="card p-6 text-neutral-700">You do not have an active Programme Hub adviser assignment.</div>}
    </main>
  );
}

function ConfigurationState({ programme, data }: { programme: ProgrammeHubProgramme; data: ProgrammeHubData }) {
  const missing = programmeNeedsReview(programme, data.contracts);
  return <section className={`rounded-md border p-4 ${missing.length ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}`} aria-label="Programme readiness">
    <h2 className="font-semibold">{missing.length ? 'Needs review' : 'Configuration ready'}</h2>
    {missing.length ? <p className="mt-1 text-sm text-amber-900">You can keep entering working records. Planned matching and adviser-approved outreach stay unavailable until these items are configured and reviewed: {missing.join(', ')}.</p> : <p className="mt-1 text-sm text-green-900">Required programme contracts are active. Matching and outreach are still planned features and are not enabled here.</p>}
    <p className="mt-1 text-xs text-neutral-600">Matching postcode areas never prove participant residency or programme eligibility.</p>
  </section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-neutral-700">{label}<span className="mt-1 block">{children}</span></label>;
}
function RecordSection({ title, empty, form, children }: { title: string; empty: string; form: React.ReactNode; children: React.ReactNode }) {
  return <section className="card p-5"><h2 className="text-xl font-semibold">{title}</h2><div className="mt-4">{form}</div><div className="mt-5 space-y-2">{Children.count(children) ? children : <p className="text-sm text-neutral-600">{empty}</p>}</div></section>;
}
function RecordRow({ title, detail, edit }: { title: string; detail: string; edit: () => void }) {
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded border border-neutral-200 p-3"><div><h3 className="font-medium">{title}</h3><p className="text-sm text-neutral-600">{detail}</p></div><button className="btn-secondary" onClick={edit}>Edit</button></article>;
}
function FormActions({ editing, busy, cancel }: { editing: boolean; busy: boolean; cancel: () => void }) {
  return <div className="flex items-end gap-2"><button className="btn-primary" disabled={busy}>{editing ? 'Save changes' : 'Add record'}</button>{editing && <button type="button" className="btn-secondary" onClick={cancel}>Cancel</button>}</div>;
}

function adviserLabel(adviserUserId: string, data: ProgrammeHubData, currentUserId: string) {
  if (adviserUserId === currentUserId) return 'You';
  const member = data.members.find((item) => item.userId === adviserUserId);
  const role = member?.role === 'owner' ? 'Owner' : member?.role === 'admin' ? 'Administrator' : 'Adviser';
  return `${role} ending ${adviserUserId.slice(-6)}`;
}

function formatProgrammeDate(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(new Date(value));
  } catch {
    return 'Time unavailable - check the programme timezone';
  }
}

function ParticipantRecord({
  participant, notes, programme, data, userId, noteDraft, notesReady, notesError, busy, edit, setNote, saveNote,
}: {
  participant: ProgrammeHubParticipant;
  notes: ProgrammeHubParticipantNote[];
  programme: ProgrammeHubProgramme;
  data: ProgrammeHubData;
  userId: string;
  noteDraft: string;
  notesReady: boolean;
  notesError: string;
  busy: boolean;
  edit: () => void;
  setNote: (body: string) => void;
  saveNote: () => void;
}) {
  return <article className="rounded border border-neutral-200 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">{participant.preferredName}</h3>
        <p className="text-sm text-neutral-600">Case reference: {participant.caseReference}</p>
        <p className="text-sm text-amber-800">{participant.residencyEvidenceReference ? 'Eligibility evidence still requires review against configured rules.' : 'Needs review - residency evidence is missing.'}</p>
      </div>
      <button className="btn-secondary" disabled={busy} onClick={edit}>Edit employment profile</button>
    </div>
    <div className="mt-4 border-t border-neutral-200 pt-4">
      <h4 className="font-medium">Programme notes</h4>
      <p className="mt-1 text-xs text-neutral-600">Record employment-support facts, agreed actions and relevant progress. Avoid diagnoses and unnecessary sensitive details.</p>
      {notesError && <p className="mt-2 text-sm text-amber-800">{notesError}</p>}
      {!notesError && !notesReady && <p className="mt-2 text-sm text-neutral-600">Loading notes...</p>}
      {!notesError && notesReady && notes.length === 0 && <p className="mt-2 text-sm text-neutral-600">No notes have been added to this participant's {programme.name} record.</p>}
      {!notesError && notes.length > 0 && <ol className="mt-3 space-y-2">{notes.map((note) => <li key={note.id} className="rounded bg-neutral-50 p-3 text-sm">
        <p className="whitespace-pre-wrap text-neutral-800">{note.body}</p>
        <p className="mt-1 text-xs text-neutral-500">{formatProgrammeDate(note.createdAt, programme.timezone)} · {adviserLabel(note.authorUserId, data, userId)}</p>
      </li>)}</ol>}
      <label className="mt-3 block text-sm font-medium text-neutral-700">Add a note
        <textarea className={`${inputClass} mt-1 min-h-24`} maxLength={2000} value={noteDraft} onChange={(event) => setNote(event.target.value)} disabled={!!notesError || busy} />
      </label>
      <button type="button" className="btn-primary mt-2" disabled={!!notesError || busy || !noteDraft.trim()} onClick={saveNote}>Save note</button>
    </div>
  </article>;
}

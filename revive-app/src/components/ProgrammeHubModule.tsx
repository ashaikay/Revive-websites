import { Children, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
import { ParticipantContactDetails } from '@/components/ParticipantContactDetails';
import type { ParticipantContactDraft, ParticipantContactRecord } from '@/services/programmeParticipantContacts';
import { ProgrammeEmployerEngagement } from '@/components/ProgrammeEmployerEngagement';
import {
  clearProgrammeHubAttempt,
  loadProgrammeHubData,
  loadProgrammeHubParticipantNotes,
  rememberProgrammeHubAttempt,
  restoreProgrammeHubAttempt,
  ProgrammeHubSaveRejectedError,
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
const programmeSelectionKey = (workspaceId: string, userId: string) => `rev-programme-hub-selection:${workspaceId}:${userId}`;
const programmeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storedProgrammeId(workspaceId: string, userId: string) {
  try {
    const value = window.localStorage.getItem(programmeSelectionKey(workspaceId, userId));
    return value && programmeIdPattern.test(value) ? value : null;
  } catch {
    return null;
  }
}

function storeProgrammeId(workspaceId: string, userId: string, programmeId: string) {
  try {
    window.localStorage.setItem(programmeSelectionKey(workspaceId, userId), programmeId);
  } catch {
    // The authorised programme remains selected for this session when browser preference storage is unavailable.
  }
}

export function ProgrammeHubModule({ workspaceId, userId }: { workspaceId: string; userId: string }) {
  const identityKey = `${workspaceId}:${userId}`;
  const identityRef = useRef(identityKey);
  identityRef.current = identityKey;
  const [data, setData] = useState<ProgrammeHubData>(emptyData);
  const [selectedProgrammeId, setSelectedProgrammeId] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [feedbackTarget, setFeedbackTarget] = useState('');
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
  const [caseloadSearch, setCaseloadSearch] = useState('');
  const [openRecordRequest, setOpenRecordRequest] = useState<{ programmeId: string; participantId: string; sequence: number } | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [notesReady, setNotesReady] = useState(false);
  const [notesError, setNotesError] = useState('');
  const [contactRefreshKeys, setContactRefreshKeys] = useState<Record<string, number>>({});

  const readGateway = useMemo(() => ({
    read: async (table: string, columns: string, ws: string) => {
      if (!supabaseClient) throw new Error('Programme Hub is unavailable.');
      const { data: rows, error: readError } = await supabaseClient.from(table).select(columns).eq('workspace_id', ws);
      if (readError) throw new Error('Programme Hub could not be loaded.');
      return rows;
    },
  }), []);

  const load = async (capturedIdentity = identityKey) => {
    const loaded = await loadProgrammeHubData(workspaceId, readGateway);
    if (identityRef.current !== capturedIdentity) return;
    setData((current) => ({ ...loaded, participantNotes: current.participantNotes }));
    setSelectedProgrammeId((current) => {
      const currentAllowed = loaded.programmes.some((programme) => programme.id === current);
      const restored = storedProgrammeId(workspaceId, userId);
      const restoredAllowed = loaded.programmes.some((programme) => programme.id === restored);
      const selected = currentAllowed
        ? current
        : restoredAllowed
          ? restored as string
          : loaded.programmes.find((programme) => programme.active)?.id ?? loaded.programmes[0]?.id ?? '';
      if (selected) storeProgrammeId(workspaceId, userId, selected);
      else {
        try {
          window.localStorage.removeItem(programmeSelectionKey(workspaceId, userId));
        } catch {
          // No authorised programme remains to restore.
        }
      }
      return selected;
    });
    setReady(true);
  };

  useEffect(() => {
    let active = true;
    const capturedIdentity = identityKey;
    setReady(false);
    setData(emptyData);
    setSelectedProgrammeId('');
    setNotesReady(false);
    setNotesError('');
    setNoteDrafts({});
    setContactRefreshKeys({});
    setCaseloadSearch('');
    setOpenRecordRequest(null);
    setError('');
    setMessage('');
    setFeedbackTarget('');
    try {
      const retained = restoreProgrammeHubAttempt(window.sessionStorage, workspaceId, userId);
      setPending(retained);
      setFeedbackTarget(retained ? saveTarget(retained) : '');
    } catch {
      setError('A retained Programme Hub save could not be read. Contact support before making another change.');
    }
    void load(capturedIdentity).catch((loadError: unknown) => {
      if (active && identityRef.current === capturedIdentity) {
        setError(loadError instanceof Error ? loadError.message : 'Programme Hub could not be loaded.');
      }
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
        setNotesError('Case notes could not be loaded. Your saved notes have not been removed. Refresh the page to try again.');
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
  const activeProgrammeAdvisers = programmeAdvisers.filter((adviser) => adviser.active && data.members.some((member) => member.userId === adviser.userId && member.status === 'active'));
  const eligibleMembers = data.members.filter((member) => member.status === 'active' && !programmeAdvisers.some((adviser) => adviser.userId === member.userId && adviser.active));
  const searchText = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB');
  const caseloadQuery = searchText(caseloadSearch);
  const visibleCaseload = programmeParticipants.filter((participant) => [participant.preferredName, participant.caseReference, ...currentCaseload(participant, data).map((assignment) => adviserLabel(assignment.adviserUserId, data, userId))].some((value) => searchText(value).includes(caseloadQuery)));
  const programmeNotes = data.participantNotes.filter((item) => item.programmeId === selectedProgrammeId);
  const selectedCaseloadAssignment = data.participantAdvisers.find((item) =>
    item.programmeId === selectedProgrammeId &&
    item.participantId === assignmentParticipantId &&
    item.adviserUserId === assignmentAdviserId,
  ) ?? null;

  const openParticipantRecord = (participant: ProgrammeHubParticipant) => {
    if (!selectedProgramme || participant.workspaceId !== workspaceId || participant.programmeId !== selectedProgramme.id || !programmeParticipants.some((item) => item.id === participant.id)) return;
    setOpenRecordRequest((current) => ({ programmeId: selectedProgramme.id, participantId: participant.id, sequence: (current?.sequence ?? 0) + 1 }));
  };

  const saveAttempt = async (attempt: ProgrammeHubSaveAttempt, success: string): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true;
    const capturedIdentity = identityKey;
    setBusy(true);
    setFeedbackTarget(saveTarget(attempt));
    setError('');
    setMessage('');
    try {
      rememberProgrammeHubAttempt(window.sessionStorage, userId, attempt);
      setPending(attempt);
      const client = supabaseClient;
      if (!client) throw new Error('Programme Hub is unavailable.');
      await submitProgrammeHubAttempt(attempt, {
        invoke: async (name, body) => {
          const { data: responseData, error: invokeError } = await client.functions.invoke(name, { body });
          if (invokeError) {
            const context = (invokeError as { context?: unknown }).context;
            if (context instanceof Response) {
              return { status: context.status, data: await context.clone().json().catch(() => null) };
            }
            throw new Error('Save outcome is unknown. Keep this page open and retry the same change.');
          }
          return { status: 200, data: responseData };
        },
      });
      clearProgrammeHubAttempt(window.sessionStorage, workspaceId, userId);
      if (identityRef.current !== capturedIdentity) return false;
      setPending(null);
      setMessage(success);
      try {
        await load(capturedIdentity);
      } catch {
        if (identityRef.current === capturedIdentity) setMessage(`${success} The record list could not refresh. Refresh the page before editing again.`);
      }
      return true;
    } catch (saveError) {
      if (identityRef.current !== capturedIdentity) return false;
      if (saveError instanceof ProgrammeHubSaveRejectedError) {
        clearProgrammeHubAttempt(window.sessionStorage, workspaceId, userId);
        setPending(null);
      }
      setError(saveError instanceof Error ? saveError.message : 'Save outcome is unknown. Keep this page open and retry the same change.');
      return false;
    } finally {
      busyRef.current = false;
      if (identityRef.current === capturedIdentity) setBusy(false);
    }
  };

  const validateForm = (form: HTMLFormElement, required: Array<[string, string]>) => {
    setFeedbackTarget(form.dataset.saveTarget ?? '');
    const missing = required.find(([value]) => !value.trim());
    if (missing) {
      setMessage('');
      setError(`Enter ${missing[1]} before saving.`);
      return false;
    }
    if (!form.checkValidity()) {
      setMessage('');
      setError('Check the highlighted fields before saving.');
      form.reportValidity();
      return false;
    }
    return true;
  };

  const attempt = (operation: ProgrammeHubSaveAttempt['operation'], programmeId: string | null, recordId: string | null, expectedVersion: number, payload: Record<string, unknown>): ProgrammeHubSaveAttempt => ({
    operation, workspaceId, programmeId, recordId, requestId: crypto.randomUUID(), expectedVersion, payload,
  });

  const retryPending = () => {
    if (!pending) return;
    const retained = pending;
    void saveAttempt(retained, 'The retained Programme Hub change was confirmed.').then(async (confirmed) => {
      if (!confirmed) return;
      if (retained.operation === 'participant_contact' && typeof retained.payload.participantId === 'string') {
        const participantId = retained.payload.participantId;
        setContactRefreshKeys((current) => ({ ...current, [participantId]: (current[participantId] ?? 0) + 1 }));
      }
      if (retained.operation !== 'participant_note') return;
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
  const renderSaveFeedback = (target: string) => feedbackTarget === target ? <SaveFeedback
    busy={busy} error={error} message={message} pending={!!pending} retry={retryPending}
  /> : null;
  const resetProgramme = () => { setProgrammeEdit(null); setProgrammeDraft(blankProgramme); };
  const resetEmployer = () => { setEmployerEdit(null); setEmployerDraft(blankEmployer); };
  const resetContact = () => { setContactEdit(null); setContactDraft({ ...blankContact, employerId: programmeEmployers[0]?.id ?? '' }); };
  const resetVacancy = () => { setVacancyEdit(null); setVacancyDraft({ ...blankVacancy, employerId: programmeEmployers[0]?.id ?? '' }); };
  const resetParticipant = () => { setParticipantEdit(null); setParticipantDraft(blankParticipant); };
  const selectProgramme = (programmeId: string) => {
    if (!data.programmes.some((programme) => programme.id === programmeId)) return;
    storeProgrammeId(workspaceId, userId, programmeId);
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
    setContactRefreshKeys({});
    setCaseloadSearch('');
    setOpenRecordRequest(null);
    setMessage('');
    setError('');
    setFeedbackTarget('');
  };

  const saveProgramme = (event: FormEvent) => {
    event.preventDefault();
    if (!validateForm(event.currentTarget as HTMLFormElement, [[programmeDraft.name, 'a programme name'], [programmeDraft.timezone, 'a programme timezone']])) return;
    void saveAttempt(
      attempt('programme', null, programmeEdit?.id ?? null, programmeEdit?.version ?? 0, programmeDraft),
      programmeEdit ? 'Programme configuration updated.' : 'Programme created.',
    ).then((confirmed) => { if (confirmed) resetProgramme(); });
  };
  const saveEmployer = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    if (!validateForm(event.currentTarget as HTMLFormElement, [[employerDraft.employerKey, 'an employer reference'], [employerDraft.displayName, 'an employer name']])) return;
    void saveAttempt(
      attempt('employer', selectedProgramme.id, employerEdit?.id ?? null, employerEdit?.version ?? 0, employerDraft),
      employerEdit ? 'Employer updated.' : 'Employer created.',
    ).then((confirmed) => { if (confirmed) resetEmployer(); });
  };
  const saveContact = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    if (!validateForm(event.currentTarget as HTMLFormElement, [
      [contactDraft.employerId, 'an employer'],
      [contactDraft.contactKey, 'a contact reference'],
      [contactDraft.preferredName, 'a contact name'],
      ...(contactDraft.suppressed ? [[contactDraft.suppressionReasonKey, 'a suppression reason'] as [string, string]] : []),
    ])) return;
    void saveAttempt(
      attempt('contact', selectedProgramme.id, contactEdit?.id ?? null, contactEdit?.version ?? 0, contactDraft),
      contactEdit ? 'Employer contact updated.' : 'Employer contact created.',
    ).then((confirmed) => { if (confirmed) resetContact(); });
  };
  const saveVacancy = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    if (!validateForm(event.currentTarget as HTMLFormElement, [[vacancyDraft.employerId, 'an employer'], [vacancyDraft.vacancyKey, 'a Job opportunity reference'], [vacancyDraft.title, 'a Job opportunity title']])) return;
    const payload = { ...vacancyDraft, requiredSkillKeys: splitKeys(vacancyDraft.requiredSkillKeys), desiredSkillKeys: splitKeys(vacancyDraft.desiredSkillKeys) };
    void saveAttempt(
      attempt('vacancy', selectedProgramme.id, vacancyEdit?.id ?? null, vacancyEdit?.version ?? 0, payload),
      vacancyEdit ? 'Vacancy updated.' : 'Vacancy created.',
    ).then((confirmed) => { if (confirmed) resetVacancy(); });
  };
  const saveParticipant = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProgramme) return;
    if (!validateForm(event.currentTarget as HTMLFormElement, [[participantDraft.participantKey, 'a Service user reference'], [participantDraft.preferredName, 'a preferred name'], [participantDraft.caseReference, 'a tenant case reference']])) return;
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
  const saveParticipantContact = (participant: ProgrammeHubParticipant, record: ParticipantContactRecord | null, draft: ParticipantContactDraft) => {
    if (!selectedProgramme || participant.programmeId !== selectedProgramme.id || participant.workspaceId !== workspaceId) return Promise.resolve(false);
    return saveAttempt(attempt('participant_contact', selectedProgramme.id, record?.id ?? null, record?.version ?? 0, { participantId: participant.id, ...draft }), 'Contact details saved.');
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

  const localFeedbackAvailable = feedbackTarget === 'programme' ? isManager
    : feedbackTarget === 'adviser' || feedbackTarget === 'participant_adviser' ? !!selectedProgramme && isManager
    : feedbackTarget === 'participant' ? !!selectedProgramme && (isManager || !!participantEdit)
    : (feedbackTarget.startsWith('participant_note:') || feedbackTarget.startsWith('participant_contact:')) ? programmeParticipants.some((participant) => feedbackTarget === `participant_note:${participant.id}` || feedbackTarget === `participant_contact:${participant.id}`)
    : !!selectedProgramme && canMaintainEmployerRecords;

  if (!ready && !error) return <main className="p-8 text-neutral-600">Loading Outcomes / Programme Hub...</main>;

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-600">Outcomes / Programme Hub</p>
        <h1 className="mt-1 text-3xl font-bold text-neutral-900">Employer Engagement</h1>
        <p className="mt-2 max-w-3xl text-neutral-600">Tenant-neutral employment-support records. This is separate from commercial GROWTH leads and worker Scheduling.</p>
      </header>

      {(!feedbackTarget || !localFeedbackAvailable) && <SaveFeedback busy={busy} error={error} message={message} pending={!!pending} retry={retryPending} />}

      {isManager && (
        <details className="card p-5" open={data.programmes.length === 0 || (feedbackTarget === 'programme' && (busy || !!pending || !!error || !!message))}>
          <summary className="cursor-pointer font-semibold">Programme configuration</summary>
          <form className="mt-4 grid gap-4 md:grid-cols-2" data-save-target="programme" noValidate onSubmit={saveProgramme}>
            <Field label="Programme name"><input disabled={busy || !!pending} required className={inputClass} value={programmeDraft.name} onChange={(event) => setProgrammeDraft({ ...programmeDraft, name: event.target.value })} /></Field>
            <Field label="Timezone"><input disabled={busy || !!pending} required className={inputClass} value={programmeDraft.timezone} onChange={(event) => setProgrammeDraft({ ...programmeDraft, timezone: event.target.value })} /></Field>
            <Field label="Tenant branding name"><input disabled={busy || !!pending} className={inputClass} value={programmeDraft.brandingName} onChange={(event) => setProgrammeDraft({ ...programmeDraft, brandingName: event.target.value })} /></Field>
            <Field label="Sender display name"><input disabled={busy || !!pending} className={inputClass} value={programmeDraft.senderDisplayName} onChange={(event) => setProgrammeDraft({ ...programmeDraft, senderDisplayName: event.target.value })} /></Field>
            <Field label="Sender reply address"><input disabled={busy || !!pending} type="email" className={inputClass} value={programmeDraft.senderReplyTo} onChange={(event) => setProgrammeDraft({ ...programmeDraft, senderReplyTo: event.target.value })} /></Field>
            <div className="flex items-end gap-2"><button className="btn-primary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={busy || !!pending}>{busy && feedbackTarget === 'programme' ? 'Saving...' : programmeEdit ? 'Save programme changes' : 'Create programme'}</button>{programmeEdit && <button type="button" className="btn-secondary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" onClick={resetProgramme}>Cancel</button>}</div>
          {renderSaveFeedback('programme')}</form>
          {data.programmes.length > 0 && <ul className="mt-4 space-y-2">{data.programmes.map((programme) => <li key={programme.id} className="flex items-center justify-between rounded border p-3"><span>{programme.name}</span><button className="btn-secondary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={!!pending} onClick={() => editProgramme(programme)}>Edit</button></li>)}</ul>}
        </details>
      )}

      {data.programmes.length > 0 && (
        <section className="card border-primary-200 bg-primary-50 p-5" aria-label="Programme selection">
          <Field label="Choose a programme">
          <select className={inputClass} value={selectedProgrammeId} disabled={busy || !!pending} onChange={(event) => selectProgramme(event.target.value)}>
            {data.programmes.map((programme) => <option key={programme.id} value={programme.id}>{programme.name}</option>)}
          </select>
          </Field>
          {(busy || pending) && <p className="mt-2 text-sm text-amber-800">Programme switching is paused until the current save is confirmed, so its exact programme and payload cannot change.</p>}
          {selectedProgramme && <p className="mt-3 text-sm text-neutral-700">You are viewing <strong>{selectedProgramme.name}</strong>. Records below belong only to this programme.</p>}
        </section>
      )}

      {selectedProgramme && isManager && <details className="card p-5">
        <summary className="cursor-pointer font-semibold">Programme settings</summary>
        <ConfigurationState programme={selectedProgramme} data={data} />
      </details>}

      {selectedProgramme && isManager && (
        <section className="card p-5" aria-labelledby="adviser-heading">
          <h2 id="adviser-heading" className="text-xl font-semibold">Employment Specialists and caseload</h2>
          <details className="mt-4 rounded-lg border border-neutral-200 p-4" open={feedbackTarget === 'adviser' && (busy || !!pending || !!error || !!message)}>
            <summary className="cursor-pointer font-medium">Manage team ({activeProgrammeAdvisers.length})</summary>
            {eligibleMembers.length > 0 && <>
            <p className="mt-3 text-sm text-neutral-600">Choose a team member to add as an Employment Specialist.</p>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
            <select disabled={busy || !!pending} aria-label="Organisation member to add as Employment Specialist" className={inputClass} value={adviserUserId} onChange={(event) => setAdviserUserId(event.target.value)}>
              <option value="">Select an existing organisation member</option>
              {eligibleMembers.map((member) => <option key={member.userId} value={member.userId}>{adviserLabel(member.userId, data, userId)}</option>)}
            </select>
            <button className="btn-primary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={!adviserUserId || busy || !!pending} onClick={() => void saveAttempt(attempt('adviser', selectedProgramme.id, null, 0, { userId: adviserUserId, active: true }), 'Employment Specialist added.').then((confirmed) => { if (confirmed) setAdviserUserId(''); })}>{busy && feedbackTarget === 'adviser' ? 'Saving...' : 'Add Employment Specialist'}</button>
          </div>
            </>}
            {eligibleMembers.length === 0 && <p className="mt-2 text-sm text-neutral-600">All available team members have been added.</p>}
            {renderSaveFeedback('adviser')}
          {activeProgrammeAdvisers.length > 0 && <ul aria-label="Active programme Employment Specialists" className="mt-3 flex flex-wrap gap-2 text-sm">{activeProgrammeAdvisers.map((adviser) => <li key={adviser.id} className="rounded bg-neutral-100 px-3 py-2">{adviserLabel(adviser.userId, data, userId)}</li>)}</ul>}
          </details>
          <h3 className="mt-5 font-semibold">Assign an Employment Specialist</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <select disabled={busy || !!pending} aria-label="Service user for caseload" className={inputClass} value={assignmentParticipantId} onChange={(event) => setAssignmentParticipantId(event.target.value)}>
              <option value="">Select Service user</option>{programmeParticipants.map((participant) => <option key={participant.id} value={participant.id}>{participant.preferredName} - {participant.caseReference}</option>)}
            </select>
            <select disabled={busy || !!pending} aria-label="Employment Specialist for caseload" className={inputClass} value={assignmentAdviserId} onChange={(event) => setAssignmentAdviserId(event.target.value)}>
              <option value="">Select Employment Specialist</option>{activeProgrammeAdvisers.map((adviser) => <option key={adviser.id} value={adviser.userId}>{adviserLabel(adviser.userId, data, userId)}</option>)}
            </select>
            <button className="btn-primary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={!assignmentParticipantId || !assignmentAdviserId || selectedCaseloadAssignment?.active || busy || !!pending} onClick={() => void saveAttempt(attempt(
              'participant_adviser',
              selectedProgramme.id,
              selectedCaseloadAssignment?.id ?? null,
              selectedCaseloadAssignment?.version ?? 0,
              { participantId: assignmentParticipantId, adviserUserId: assignmentAdviserId, active: true },
            ), selectedCaseloadAssignment ? 'Assignment restored.' : 'Assigned.').then((confirmed) => {
              if (confirmed) {
                setAssignmentParticipantId('');
                setAssignmentAdviserId('');
              }
            })}>{busy && feedbackTarget === 'participant_adviser' ? 'Saving...' : selectedCaseloadAssignment?.active ? 'Already assigned' : selectedCaseloadAssignment ? 'Restore assignment' : 'Assign ES'}</button>{renderSaveFeedback('participant_adviser')}
          </div>
          {activeProgrammeAdvisers.length === 0 && <p className="mt-2 text-sm text-neutral-600">Add an Employment Specialist under Manage team first.</p>}
          <div className="mt-5 border-t border-neutral-200 pt-4" aria-label="Caseload overview">
            <h3 className="font-semibold">Caseload overview</h3>
            <p className="mt-1 text-sm text-neutral-600">{programmeParticipants.length} {programmeParticipants.length === 1 ? 'Service user' : 'Service users'}{programmeParticipants.length > 0 && (programmeParticipants.some((participant) => currentCaseload(participant, data).length === 0) ? ` · ${programmeParticipants.filter((participant) => currentCaseload(participant, data).length === 0).length} unassigned` : ' · All assigned')}</p>
            <label className="mt-3 block text-sm font-medium">Search caseload<input className={`${inputClass} mt-1`} value={caseloadSearch} onChange={(event) => setCaseloadSearch(event.target.value)} placeholder="Name, case reference or ES" /></label>
            {programmeParticipants.length === 0 ? <p className="mt-3 text-sm text-neutral-600">Add a Service user to this programme before assigning a caseload.</p>
              : visibleCaseload.length === 0 ? <p className="mt-3 text-sm text-neutral-600">No Service users match this search.</p>
              : <ul className="mt-3 space-y-3">{visibleCaseload.map((participant) => <li key={participant.id} className="rounded border border-neutral-200 p-3">
                <p className="font-medium">{participant.preferredName} · {participant.caseReference}{!participant.active ? ' · Inactive record' : ''}</p>
                <CaseloadDetails participant={participant} data={data} userId={userId} programme={selectedProgramme} />
                <p className="mt-2 text-sm text-neutral-600">Desired work: {participant.desiredRoleKeys.join(', ') || 'Not added'}</p>
                <p className="text-sm text-neutral-600">Job search areas: {participant.vacancySearchGeographyKeys.join(', ') || 'Not added'}</p>
                <p className="mt-1 text-sm text-neutral-600">{notesError ? 'Case notes unavailable' : !notesReady ? 'Loading case notes...' : programmeNotes.find((note) => note.participantId === participant.id) ? `Latest case note: ${formatProgrammeDate(programmeNotes.find((note) => note.participantId === participant.id)!.createdAt, selectedProgramme.timezone)}` : 'No case notes yet'}</p>
                <button type="button" className="btn-secondary mt-3 focus-visible:ring-2" onClick={() => openParticipantRecord(participant)}>Open Service-user record</button>
              </li>)}</ul>}
          </div>
        </section>
      )}

      {selectedProgramme && canMaintainEmployerRecords && (
        <>
          <h2 className="text-xl font-semibold">Employers and contacts</h2>
          <ProgrammeEmployerEngagement
            key={`${workspaceId}:${selectedProgramme.id}`}
            workspaceId={workspaceId}
            userId={userId}
            programme={selectedProgramme}
            employers={programmeEmployers}
            contacts={programmeContacts}
            advisers={programmeAdvisers}
            members={data.members}
            isManager={isManager}
            canMaintain={canMaintainEmployerRecords}
            onEmployersChanged={load}
          />
          <h3 className="text-lg font-semibold">Manual employer and contact records</h3>
          <RecordSection title="Employers" empty="No employers have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" data-save-target="employer" noValidate onSubmit={saveEmployer}>
            <Field label="Employer reference (for example, EMP-001)"><input disabled={busy || !!pending} required className={inputClass} value={employerDraft.employerKey} onChange={(event) => setEmployerDraft({ ...employerDraft, employerKey: event.target.value })} /></Field>
            <Field label="Employer name"><input disabled={busy || !!pending} required className={inputClass} value={employerDraft.displayName} onChange={(event) => setEmployerDraft({ ...employerDraft, displayName: event.target.value })} /></Field>
            <Field label="Sector (for example, retail)"><input disabled={busy || !!pending} className={inputClass} value={employerDraft.sectorKey} onChange={(event) => setEmployerDraft({ ...employerDraft, sectorKey: event.target.value })} /></Field>
            <Field label="Primary work area reference"><input disabled={busy || !!pending} className={inputClass} value={employerDraft.primaryGeographyKey} onChange={(event) => setEmployerDraft({ ...employerDraft, primaryGeographyKey: event.target.value })} /></Field>
            <FormActions editing={!!employerEdit} saving={busy && feedbackTarget === 'employer'} busy={busy || !!pending} cancel={resetEmployer} />
          {renderSaveFeedback('employer')}</form>}>
            {programmeEmployers.map((employer) => <RecordRow key={employer.id} title={employer.displayName} detail={employer.employerKey} edit={() => editEmployer(employer)} fields={[
              ['Employer reference', employer.employerKey], ['Sector', employer.sectorKey],
              ['Work area', employer.primaryGeographyKey], ['Record status', employer.active ? 'Active' : 'Inactive'],
            ]} />)}
          </RecordSection>

          <RecordSection title="Employer contacts" empty="No employer contacts have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" data-save-target="contact" noValidate onSubmit={saveContact}>
            <Field label="Employer"><select disabled={busy || !!pending} required className={inputClass} value={contactDraft.employerId} onChange={(event) => setContactDraft({ ...contactDraft, employerId: event.target.value })}><option value="">Select employer</option>{programmeEmployers.map((employer) => <option key={employer.id} value={employer.id}>{employer.displayName}</option>)}</select></Field>
            <Field label="Contact reference (for example, CONTACT-001)"><input disabled={busy || !!pending} required className={inputClass} value={contactDraft.contactKey} onChange={(event) => setContactDraft({ ...contactDraft, contactKey: event.target.value })} /></Field>
            <Field label="Preferred name"><input disabled={busy || !!pending} required className={inputClass} value={contactDraft.preferredName} onChange={(event) => setContactDraft({ ...contactDraft, preferredName: event.target.value })} /></Field>
            <Field label="Role title"><input disabled={busy || !!pending} className={inputClass} value={contactDraft.roleTitle} onChange={(event) => setContactDraft({ ...contactDraft, roleTitle: event.target.value })} /></Field>
            <Field label="Business email"><input disabled={busy || !!pending} type="email" className={inputClass} value={contactDraft.businessEmail} onChange={(event) => setContactDraft({ ...contactDraft, businessEmail: event.target.value })} /></Field>
            <Field label="Business phone"><input disabled={busy || !!pending} className={inputClass} value={contactDraft.businessPhone} onChange={(event) => setContactDraft({ ...contactDraft, businessPhone: event.target.value })} /></Field>
            <label className="flex items-center gap-2 text-sm"><input disabled={busy || !!pending} type="checkbox" checked={contactDraft.suppressed} onChange={(event) => setContactDraft({ ...contactDraft, suppressed: event.target.checked })} />Suppress engagement preparation</label>
            {contactDraft.suppressed && <Field label="Reason for suppression"><input disabled={busy || !!pending} required className={inputClass} value={contactDraft.suppressionReasonKey} onChange={(event) => setContactDraft({ ...contactDraft, suppressionReasonKey: event.target.value })} /></Field>}
            <FormActions editing={!!contactEdit} saving={busy && feedbackTarget === 'contact'} busy={busy || !!pending} cancel={resetContact} />
          {renderSaveFeedback('contact')}</form>}>
            {programmeContacts.map((contact) => <RecordRow key={contact.id} title={contact.preferredName} detail={`${programmeEmployers.find((employer) => employer.id === contact.employerId)?.displayName ?? 'Employer'}${contact.suppressed ? ' - Suppressed' : ''}`} edit={() => editContact(contact)} fields={[
              ['Contact reference', contact.contactKey], ['Employer', programmeEmployers.find((employer) => employer.id === contact.employerId)?.displayName],
              ['Role title', contact.roleTitle], ['Business email', contact.businessEmail], ['Business phone', contact.businessPhone],
              ['Engagement preparation', contact.suppressed ? 'Suppressed' : 'Not suppressed'],
              ['Record status', contact.active ? 'Active' : 'Inactive'],
            ]} />)}
          </RecordSection>

          <RecordSection title="Job opportunities" empty="No Job opportunities have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" data-save-target="vacancy" noValidate onSubmit={saveVacancy}>
            <Field label="Employer"><select disabled={busy || !!pending} required className={inputClass} value={vacancyDraft.employerId} onChange={(event) => setVacancyDraft({ ...vacancyDraft, employerId: event.target.value, employerContactId: '' })}><option value="">Select employer</option>{programmeEmployers.map((employer) => <option key={employer.id} value={employer.id}>{employer.displayName}</option>)}</select></Field>
            <Field label="Employer contact"><select disabled={busy || !!pending} className={inputClass} value={vacancyDraft.employerContactId} onChange={(event) => setVacancyDraft({ ...vacancyDraft, employerContactId: event.target.value })}><option value="">No contact selected</option>{programmeContacts.filter((contact) => contact.employerId === vacancyDraft.employerId).map((contact) => <option key={contact.id} value={contact.id}>{contact.preferredName}</option>)}</select></Field>
            <Field label="Vacancy reference (for example, VAC-001)"><input disabled={busy || !!pending} required className={inputClass} value={vacancyDraft.vacancyKey} onChange={(event) => setVacancyDraft({ ...vacancyDraft, vacancyKey: event.target.value })} /></Field>
            <Field label="Vacancy title"><input disabled={busy || !!pending} required className={inputClass} value={vacancyDraft.title} onChange={(event) => setVacancyDraft({ ...vacancyDraft, title: event.target.value })} /></Field>
            <Field label="Work area reference"><input disabled={busy || !!pending} className={inputClass} value={vacancyDraft.workGeographyKey} onChange={(event) => setVacancyDraft({ ...vacancyDraft, workGeographyKey: event.target.value })} /></Field>
            <Field label="Required skills (comma separated)"><input disabled={busy || !!pending} className={inputClass} value={vacancyDraft.requiredSkillKeys} onChange={(event) => setVacancyDraft({ ...vacancyDraft, requiredSkillKeys: event.target.value })} /></Field>
            <Field label="Helpful skills (comma separated)"><input disabled={busy || !!pending} className={inputClass} value={vacancyDraft.desiredSkillKeys} onChange={(event) => setVacancyDraft({ ...vacancyDraft, desiredSkillKeys: event.target.value })} /></Field>
            <FormActions editing={!!vacancyEdit} saving={busy && feedbackTarget === 'vacancy'} busy={busy || !!pending} cancel={resetVacancy} />
          {renderSaveFeedback('vacancy')}</form>}>
            {programmeVacancies.map((vacancy) => <RecordRow key={vacancy.id} title={vacancy.title} detail={vacancy.workGeographyKey ? `Work area: ${vacancy.workGeographyKey}` : 'Work area needs review'} edit={() => editVacancy(vacancy)} fields={[
              ['Job opportunity reference', vacancy.vacancyKey], ['Employer', programmeEmployers.find((employer) => employer.id === vacancy.employerId)?.displayName],
              ['Employer contact', programmeContacts.find((contact) => contact.id === vacancy.employerContactId)?.preferredName],
              ['Work area', vacancy.workGeographyKey], ['Required skills', vacancy.requiredSkillKeys], ['Helpful skills', vacancy.desiredSkillKeys],
              ['Record status', vacancy.active ? 'Active' : 'Inactive'],
            ]} />)}
          </RecordSection>
        </>
      )}

      {selectedProgramme && isManager && (
        <RecordSection title="Service users" empty="No Service users have been added to this programme." form={<form className="grid gap-3 md:grid-cols-3" data-save-target="participant" noValidate onSubmit={saveParticipant}>
          <Field label="Participant reference (for example, PART-001)"><input disabled={busy || !!pending} required className={inputClass} value={participantDraft.participantKey} onChange={(event) => setParticipantDraft({ ...participantDraft, participantKey: event.target.value })} /></Field>
          <Field label="Preferred name"><input disabled={busy || !!pending} required className={inputClass} value={participantDraft.preferredName} onChange={(event) => setParticipantDraft({ ...participantDraft, preferredName: event.target.value })} /></Field>
          <Field label="Tenant case reference"><input disabled={busy || !!pending} required className={inputClass} value={participantDraft.caseReference} onChange={(event) => setParticipantDraft({ ...participantDraft, caseReference: event.target.value })} /></Field>
          <Field label="Desired roles (comma separated)"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.desiredRoleKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, desiredRoleKeys: event.target.value })} /></Field>
          <Field label="Employment skills (comma separated)"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.skillKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, skillKeys: event.target.value })} /></Field>
          <Field label="Vacancy search areas (comma separated)"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.vacancySearchGeographyKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, vacancySearchGeographyKeys: event.target.value })} /></Field>
          <Field label="Residency evidence reference"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.residencyEvidenceReference} onChange={(event) => setParticipantDraft({ ...participantDraft, residencyEvidenceReference: event.target.value })} /></Field>
          <FormActions editing={!!participantEdit} saving={busy && feedbackTarget === 'participant'} busy={busy || !!pending} cancel={resetParticipant} />
        {renderSaveFeedback('participant')}</form>}>
          {programmeParticipants.map((participant) => <ParticipantRecord key={participant.id} participant={participant} contactDetails={(openRequest) => <ParticipantContactDetails workspaceId={workspaceId} programmeId={selectedProgramme.id} participantId={participant.id} openRequest={openRequest} refreshKey={contactRefreshKeys[participant.id] ?? 0} busy={busy || !!pending} pending={pending} feedback={renderSaveFeedback(`participant_contact:${participant.id}`)} onSave={(record, draft) => saveParticipantContact(participant, record, draft)} />} openRequest={openRecordRequest?.programmeId === selectedProgramme.id && openRecordRequest.participantId === participant.id ? openRecordRequest.sequence : 0} openRecord={() => openParticipantRecord(participant)} notes={programmeNotes.filter((note) => note.participantId === participant.id)} programme={selectedProgramme} data={data} userId={userId} noteDraft={noteDrafts[participant.id] ?? ''} notesReady={notesReady} notesError={notesError} busy={busy || !!pending} saving={busy && feedbackTarget === `participant_note:${participant.id}`} feedback={renderSaveFeedback(`participant_note:${participant.id}`)} keepNotesOpen={feedbackTarget === `participant_note:${participant.id}` && (!!pending || !!error || busy)} edit={() => editParticipant(participant)} setNote={(body) => setNoteDrafts((current) => ({ ...current, [participant.id]: body }))} saveNote={() => saveParticipantNote(participant)} />)}
        </RecordSection>
      )}

      {selectedProgramme && isAdviser && !isManager && (
        <section className="card p-5">
          <h2 className="text-xl font-semibold">My assigned Service users</h2>
          <label className="mt-3 block text-sm font-medium">Search Service users<input className={`${inputClass} mt-1`} disabled={busy || !!pending} value={caseloadSearch} onChange={(event) => setCaseloadSearch(event.target.value)} placeholder="Name or case reference" /></label>
          <div className="mt-3 space-y-3">{visibleCaseload.map((participant) => <ParticipantRecord key={participant.id} participant={participant} contactDetails={(openRequest) => <ParticipantContactDetails workspaceId={workspaceId} programmeId={selectedProgramme.id} participantId={participant.id} openRequest={openRequest} refreshKey={contactRefreshKeys[participant.id] ?? 0} busy={busy || !!pending} pending={pending} feedback={renderSaveFeedback(`participant_contact:${participant.id}`)} onSave={(record, draft) => saveParticipantContact(participant, record, draft)} />} openRequest={openRecordRequest?.programmeId === selectedProgramme.id && openRecordRequest.participantId === participant.id ? openRecordRequest.sequence : 0} openRecord={() => openParticipantRecord(participant)} notes={programmeNotes.filter((note) => note.participantId === participant.id)} programme={selectedProgramme} data={data} userId={userId} noteDraft={noteDrafts[participant.id] ?? ''} notesReady={notesReady} notesError={notesError} busy={busy || !!pending} saving={busy && feedbackTarget === `participant_note:${participant.id}`} feedback={renderSaveFeedback(`participant_note:${participant.id}`)} keepNotesOpen={feedbackTarget === `participant_note:${participant.id}` && (!!pending || !!error || busy)} edit={() => editParticipant(participant)} setNote={(body) => setNoteDrafts((current) => ({ ...current, [participant.id]: body }))} saveNote={() => saveParticipantNote(participant)} />)}</div>
          {programmeParticipants.length === 0 && <p className="mt-3 text-sm text-neutral-600">No Service users are currently assigned to your caseload in this programme.</p>}
          {programmeParticipants.length > 0 && visibleCaseload.length === 0 && <p className="mt-3 text-sm text-neutral-600">No Service users match this search.</p>}
          {participantEdit && <form className="mt-4 grid gap-3 md:grid-cols-2" data-save-target="participant" noValidate onSubmit={saveParticipant}><Field label="Preferred name"><input disabled={busy || !!pending} required className={inputClass} value={participantDraft.preferredName} onChange={(event) => setParticipantDraft({ ...participantDraft, preferredName: event.target.value })} /></Field><Field label="Desired roles"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.desiredRoleKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, desiredRoleKeys: event.target.value })} /></Field><Field label="Employment skills"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.skillKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, skillKeys: event.target.value })} /></Field><Field label="Vacancy search areas"><input disabled={busy || !!pending} className={inputClass} value={participantDraft.vacancySearchGeographyKeys} onChange={(event) => setParticipantDraft({ ...participantDraft, vacancySearchGeographyKeys: event.target.value })} /></Field><FormActions editing saving={busy && feedbackTarget === 'participant'} busy={busy || !!pending} cancel={resetParticipant} />{renderSaveFeedback('participant')}</form>}
        </section>
      )}

      {!isManager && !isAdviser && ready && <div className="card p-6 text-neutral-700">You do not have an active Programme Hub adviser assignment.</div>}
    </main>
  );
}

function ConfigurationState({ programme, data }: { programme: ProgrammeHubProgramme; data: ProgrammeHubData }) {
  const missing = programmeNeedsReview(programme, data.contracts);
  return <section className="mt-4 border-t border-neutral-200 pt-4" aria-label="Programme settings status">
    <h2 className="font-medium">Configuration status</h2>
    {missing.length
      ? <p className="mt-1 text-sm text-neutral-700">The following configuration is not available in this interface: {missing.join(', ')}. Features that depend on it remain unavailable.</p>
      : <p className="mt-1 text-sm text-neutral-700">Required programme contracts are active. This does not enable matching, outreach sending or other unfinished features.</p>}
    <p className="mt-2 text-xs text-neutral-600">Postcode or location overlap never proves participant residency or programme eligibility.</p>
  </section>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-neutral-700">{label}<span className="mt-1 block">{children}</span></label>;
}
function RecordSection({ title, empty, form, children }: { title: string; empty: string; form: React.ReactNode; children: React.ReactNode }) {
  return <section className="card p-5"><h2 className="text-xl font-semibold">{title}</h2><div className="mt-4">{form}</div><div className="mt-5 space-y-2">{Children.count(children) ? children : <p className="text-sm text-neutral-600">{empty}</p>}</div></section>;
}
type DetailValue = string | string[] | null | undefined;
function DetailFields({ fields }: { fields: Array<[string, DetailValue]> }) {
  return <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">{fields.map(([label, value]) => {
    const display = Array.isArray(value) ? value.join(', ') : value;
    return <div key={label}><dt className="font-medium text-neutral-700">{label}</dt><dd className="whitespace-pre-wrap break-words text-neutral-600">{display?.trim() || 'Not provided'}</dd></div>;
  })}</dl>;
}
function RecordRow({ title, detail, edit, fields }: { title: string; detail: string; edit: () => void; fields: Array<[string, DetailValue]> }) {
  return <article className="rounded border border-neutral-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-medium">{title}</h3><p className="text-sm text-neutral-600">{detail}</p></div><button type="button" className="btn-secondary focus-visible:ring-2 active:scale-[0.98]" onClick={edit}>Edit</button></div>
    <details className="mt-3"><summary className="cursor-pointer font-medium text-primary-700 focus-visible:ring-2">View details</summary><DetailFields fields={fields} /></details>
  </article>;
}
function FormActions({ editing, busy, saving, cancel }: { editing: boolean; busy: boolean; saving: boolean; cancel: () => void }) {
  return <div className="flex items-end gap-2"><button className="btn-primary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={busy}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Add record'}</button>{editing && <button type="button" disabled={busy} className="btn-secondary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" onClick={cancel}>Cancel</button>}</div>;
}
function saveTarget(attempt: ProgrammeHubSaveAttempt) {
  return attempt.operation === 'participant_note' || attempt.operation === 'participant_contact' ? `${attempt.operation}:${attempt.payload.participantId}` : attempt.operation;
}
function SaveFeedback({ busy, error, message, pending, retry }: { busy: boolean; error: string; message: string; pending: boolean; retry: () => void }) {
  return <div className="col-span-full mt-2" aria-live="polite" aria-atomic="true">
    {busy ? <p role="status" className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">Saving this Programme Hub change. Please wait.</p>
      : error ? <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}{pending && <button type="button" className="btn-secondary ml-2 focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" onClick={retry}>Retry same change</button>}</div>
      : pending ? <div role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">A retained save must be confirmed before another change.<button type="button" className="btn-secondary ml-2 focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" onClick={retry}>Retry same change</button></div>
      : message ? <p role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p> : null}
  </div>;
}

function adviserLabel(adviserUserId: string, data: ProgrammeHubData, currentUserId: string) {
  if (adviserUserId === currentUserId) return 'You';
  const member = data.members.find((item) => item.userId === adviserUserId);
  const role = member?.role === 'owner' ? 'Owner' : member?.role === 'admin' ? 'Administrator' : 'Employment Specialist';
  return `${role} ending ${adviserUserId.slice(-6)}`;
}

function currentCaseload(participant: ProgrammeHubParticipant, data: ProgrammeHubData) {
  return data.participantAdvisers.filter((assignment) => assignment.workspaceId === participant.workspaceId && assignment.programmeId === participant.programmeId && assignment.participantId === participant.id && assignment.active
    && data.advisers.some((adviser) => adviser.workspaceId === participant.workspaceId && adviser.programmeId === participant.programmeId && adviser.userId === assignment.adviserUserId && adviser.active)
    && data.members.some((member) => member.userId === assignment.adviserUserId && member.status === 'active'));
}
function CaseloadDetails({ participant, data, userId, programme }: { participant: ProgrammeHubParticipant; data: ProgrammeHubData; userId: string; programme: ProgrammeHubProgramme }) {
  const assignments = currentCaseload(participant, data);
  return <div className="mt-2 text-sm" aria-label="Assigned Employment Specialists">
    {assignments.length === 0 ? <p className="text-neutral-600">No active Employment Specialist assigned.</p>
      : <ul className="space-y-2">{assignments.map((assignment) => <li key={assignment.id}>
        <p className="font-medium">Assigned to {adviserLabel(assignment.adviserUserId, data, userId)}</p>
        <details className="mt-1"><summary className="cursor-pointer text-sm text-neutral-600">View dates</summary>
          <p className="mt-2 text-sm text-neutral-600">First assigned: {assignment.createdAt ? formatProgrammeDate(assignment.createdAt, programme.timezone) : 'Date unavailable'}</p>
          <p className="text-sm text-neutral-600">Last updated: {assignment.updatedAt ? formatProgrammeDate(assignment.updatedAt, programme.timezone) : 'Date unavailable'}</p>
        </details>
      </li>)}</ul>}
  </div>;
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
  participant, contactDetails, openRequest, openRecord, notes, programme, data, userId, noteDraft, notesReady, notesError, busy, saving, feedback, keepNotesOpen, edit, setNote, saveNote,
}: {
  participant: ProgrammeHubParticipant;
  contactDetails: (openRequest: number) => React.ReactNode;
  openRequest: number;
  openRecord: () => void;
  notes: ProgrammeHubParticipantNote[];
  programme: ProgrammeHubProgramme;
  data: ProgrammeHubData;
  userId: string;
  noteDraft: string;
  notesReady: boolean;
  notesError: string;
  busy: boolean;
  saving: boolean;
  feedback: React.ReactNode;
  keepNotesOpen: boolean;
  edit: () => void;
  setNote: (body: string) => void;
  saveNote: () => void;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const recordRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (!openRequest) return;
    if (profileRef.current) profileRef.current.open = true;
    setNotesOpen(true);
    recordRef.current?.focus({ preventScroll: true });
    recordRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
  }, [openRequest]);
  const notesDisclosureOpen = notesOpen || !!noteDraft.trim() || keepNotesOpen;
  return <article ref={recordRef} tabIndex={-1} aria-label={`${participant.preferredName} — ${programme.name} record`} className="rounded border border-neutral-200 p-4 focus:outline-none focus:ring-2 focus:ring-primary-500">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="font-semibold">{participant.preferredName}</h3>
        <p className="text-sm text-neutral-600">Case reference: {participant.caseReference}</p>
        <p className="text-sm text-neutral-600">Programme: {programme.name}</p>
        <p className="text-sm text-amber-800">{participant.residencyEvidenceReference ? 'Eligibility evidence still requires review against configured rules.' : 'Needs review - residency evidence is missing.'}</p>
      </div>
      <div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary focus-visible:ring-2" onClick={openRecord}>Open Service-user record</button>
      <button className="btn-secondary focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={busy} onClick={edit}>Edit employment profile</button></div>
    </div>
    <CaseloadDetails participant={participant} data={data} userId={userId} programme={programme} />
    <details ref={profileRef} className="mt-3"><summary className="cursor-pointer font-medium text-primary-700">View employment profile</summary>
      <DetailFields fields={[
        ['Service user reference', participant.participantKey], ['Case reference', participant.caseReference],
        ['Desired roles', participant.desiredRoleKeys], ['Employment skills', participant.skillKeys],
        ['Job search areas', participant.vacancySearchGeographyKeys], ['Residency evidence reference', participant.residencyEvidenceReference],
        ['Record status', participant.active ? 'Active' : 'Inactive'],
      ]} />
    </details>
    {contactDetails(openRequest)}
    <details className="mt-4 border-t border-neutral-200 pt-4" open={notesDisclosureOpen} onToggle={(event) => { if (!event.currentTarget.open && (noteDraft.trim() || keepNotesOpen)) event.currentTarget.open = true; setNotesOpen(event.currentTarget.open); }}>
      <summary className="cursor-pointer font-medium">Case notes ({notesError ? 'could not load' : !notesReady ? 'loading' : notes.length}){!notesError && notesReady && notes[0] ? ` · Latest: ${formatProgrammeDate(notes[0].createdAt, programme.timezone)}` : ''}</summary>
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
      {!notesError && !noteDraft.trim() && <p className="mt-1 text-xs text-neutral-600">Enter an employment-support note to enable Save note.</p>}
      <button type="button" className="btn-primary mt-2 focus-visible:ring-2 active:scale-[0.98] disabled:cursor-not-allowed" disabled={!!notesError || busy || !noteDraft.trim()} onClick={saveNote}>{saving ? 'Saving...' : 'Save note'}</button>
      {feedback}
    </details>
  </article>;
}

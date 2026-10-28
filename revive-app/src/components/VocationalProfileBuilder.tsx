import { useEffect, useRef, useState } from 'react';
import { coreVocationalQuestionCount } from '../domain/vocationalCore';
import { supabaseClient } from '@/data/supabaseClient';
import { createVocationalTemplate, addVocationalSection, addVocationalQuestion, addCoreVocationalQuestions } from '../domain/vocationalTemplateBuilder';
import { validateVocationalTemplate, vocationalStandardFields, isRestrictedVocationalQuestion, type VocationalStandardField, type VocationalFieldType, type VocationalProfileTemplate, type VocationalQuestion } from '../domain/vocationalProfile';

const types: { value: VocationalFieldType; label: string }[] = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'single_select', label: 'Dropdown' },
  { value: 'multi_select', label: 'Multiple selection' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'yes_no_prefer_not', label: 'Yes / No / Prefer not to say' },
];

type Props = { workspaceId: string; userId: string; programmeId?: string | null };
const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100';

function PreviewQuestion({ question }: { question: VocationalQuestion }) {
  const options = question.options ?? [];
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-3">
      <label className="block text-sm font-medium">{question.label}{question.required ? ' *' : ''}</label>
      {question.type === 'short_text' && <input className={field} aria-label={question.label} />}
      {question.type === 'long_text' && <textarea className={field} aria-label={question.label} />}
      {question.type === 'number' && <input className={field} type="number" aria-label={question.label} />}
      {question.type === 'date' && <input className={field} type="date" aria-label={question.label} />}
      {question.type === 'single_select' && <select className={field} aria-label={question.label} defaultValue=""><option value="">Choose an answer</option>{options.map(o => <option key={o}>{o}</option>)}</select>}
      {question.type === 'multi_select' && options.map(o => <label className="block text-sm" key={o}><input type="checkbox" /> {o}</label>)}
      {question.type === 'checkbox' && <input type="checkbox" aria-label={question.label} />}
      {question.type === 'yes_no_prefer_not' && <select className={field} aria-label={question.label} defaultValue=""><option value="">Choose an answer</option><option>Yes</option><option>No</option><option>Prefer not to say</option></select>}
    </div>
  );
}

export default function VocationalProfileBuilder({ workspaceId, userId, programmeId = null }: Props) {
  const [template, setTemplate] = useState<VocationalProfileTemplate | null>(null);
  const [activeId, setActiveId] = useState('');
  const [newSection, setNewSection] = useState('');
  const [questionLabel, setQuestionLabel] = useState('');
  const [questionType, setQuestionType] = useState<VocationalFieldType>('short_text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);
  const [standardField, setStandardField] = useState<VocationalStandardField | ''>('');
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityUncertain, setAvailabilityUncertain] = useState(false);
  const availabilityLock = useRef(false);
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [pending, setPending] = useState<{ requestId: string; templateId: string | null; expectedVersion: number; title: string; description: string; sections: VocationalProfileTemplate['sections'] } | null>(null);
  const scope = `${workspaceId}:${programmeId ?? 'organisation'}:${userId}`;
  const generation = useRef(0);
  const saveLock = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const sectionHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    sectionHeading.current?.focus({ preventScroll: true });
    sectionHeading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);
  useEffect(() => {
    if (message || error) { feedback.current?.focus({ preventScroll: true }); feedback.current?.scrollIntoView?.({ block: 'nearest' }); }
  }, [message, error]);
  const pendingKey = `rev-vocational-pending:${scope}`;
  const currentScope = useRef(scope);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    generation.current++;
    saveLock.current = false; availabilityLock.current = false;
  }

  const load = async (confirmReload = false, targetId?: string) => {
    const seq = ++generation.current;
    setLoading(true);
    setError(''); setMessage('');
    try {
      if (!supabaseClient) throw Error('Supabase is unavailable.');
      let query = supabaseClient.from('programme_hub_vocational_templates')
        .select('id,workspace_id,programme_id,title,description,status,version,sections,created_at,updated_at,published_at,created_by_user_id')
        .eq('workspace_id', workspaceId);
      query = programmeId ? query.eq('programme_id', programmeId) : query.is('programme_id', null);
      if (targetId) query = query.eq('id', targetId);
      const { data, error: readError } = await query.order('updated_at', { ascending: false }).limit(1);
      if (readError) throw readError;
      if (seq !== generation.current) return;
      const row = data?.[0];
      if (targetId && (!row || row.id !== targetId)) throw Error('Questionnaire availability could not be verified. Try Check availability again.');
      if (row) {
        const loaded: VocationalProfileTemplate = {
          id: row.id, workspaceId, programmeId: row.programme_id,
          title: row.title, description: row.description, status: row.status,
          version: Number(row.version), sections: row.sections,
          createdAt: row.created_at, updatedAt: row.updated_at,
          publishedAt: row.published_at ?? undefined, createdBy: row.created_by_user_id,
        };
        savedId.current = loaded.id; setTemplate(loaded);
        setActiveId(loaded.sections[0]?.id ?? '');
        setPreview(loaded.status === 'published');
      } else { savedId.current = null; setTemplate(null); setActiveId(''); }
      setDirty(false);
      setAvailabilityUncertain(false);
      if (confirmReload) setMessage(row?.status === 'published' ? 'Questionnaire is available to assigned staff.' : 'Saved questionnaire loaded. Review it, then choose Save and make available.');
    } catch (cause) {
      if (seq === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to load templates.');
    } finally { if (seq === generation.current) setLoading(false); }
  };

  useEffect(() => {
    let valid = true;
    setPending(null); setBusy(false); setMessage(''); setDirty(false); setRecoveryBlocked(false);
    setAvailabilityBusy(false); setAvailabilityUncertain(false); availabilityLock.current = false;
    setTemplate(null); savedId.current = null; setActiveId(''); setPreview(false);
    setNewSection(''); setQuestionLabel(''); setOptionsText('');
    setQuestionType('short_text'); setRequired(false); setStandardField('');
    try {
      const raw = window.sessionStorage.getItem(pendingKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.requestId === 'string' && Array.isArray(parsed.sections)) setPending(parsed);
        else throw Error('Invalid pending save');
      }
    } catch { if (valid) setRecoveryBlocked(true); }
    void load();
    return () => { valid = false; generation.current++; };
  }, [scope]);

  const save = async (retry = false) => {
    if (!supabaseClient || saveLock.current || recoveryBlocked || loading || (!retry && (!template || pending))) return null;
    const problems = template ? validateVocationalTemplate(template) : [];
    if (!retry && problems.length) { setError(problems.join(' ')); return null; }
    const attempt = retry ? pending : template ? {
      requestId: crypto.randomUUID(), templateId: savedId.current,
      expectedVersion: savedId.current ? template.version : 0,
      title: template.title.trim(), description: template.description ?? '', sections: template.sections,
    } : null;
    if (!attempt) return null;
    const seq = generation.current;
    try {
      saveLock.current = true; setBusy(true); setError(''); setMessage('');
      if (!retry) { window.sessionStorage.setItem(pendingKey, JSON.stringify(attempt)); setPending(attempt); }
      const { data, error: rpcError } = await supabaseClient.rpc('save_rev_vocational_template', {
        target_workspace_id: workspaceId, target_request_id: attempt.requestId,
        target_template_id: attempt.templateId, expected_version: attempt.expectedVersion,
        target_programme_id: programmeId, target_title: attempt.title,
        target_description: attempt.description, target_sections: attempt.sections,
      });
      if (seq !== generation.current) return null;
      if (rpcError) throw rpcError;
      if (!data || typeof data.id !== 'string' || data.status !== 'draft' || Number(data.version) !== (attempt.templateId ? attempt.expectedVersion + 1 : 1)) throw Error('Unexpected save response.');
      window.sessionStorage.removeItem(pendingKey);
      setPending(null); savedId.current = data.id;
      setTemplate(current => current ? { ...current, id: data.id, version: Number(data.version), updatedAt: new Date().toISOString() } : current);
      setDirty(false); setMessage('Draft saved.');
      return { id: data.id as string, version: Number(data.version) };
    } catch { if (seq === generation.current) setError('Save not confirmed. Retry the same save before making further changes.'); return null; }
    finally { if (seq === generation.current) { saveLock.current = false; setBusy(false); } }
  };

  const publish = async () => {
    if (!template || !savedId.current || dirty || pending || busy || availabilityUncertain || availabilityLock.current || saveLock.current || recoveryBlocked || !supabaseClient) return;
    if (coreVocationalQuestionCount(template.sections) === 0) { setError('Add core employment questions before publishing. Optional support questions do not count towards the core profile.'); return; }
    if (!window.confirm('Publish this questionnaire? The published version cannot be edited.')) return;
    const seq = generation.current;
    saveLock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error: rpcError } = await supabaseClient.rpc('publish_rev_vocational_template', {
        target_workspace_id: workspaceId, target_template_id: savedId.current,
        expected_version: template.version,
      });
      if (seq !== generation.current) return;
      if (rpcError) throw rpcError;
      if (!data || data.status !== 'published' || data.id !== savedId.current) throw Error('Publication not confirmed.');
      setTemplate(current => current ? { ...current, status: 'published' } : current);
      setPreview(true); setMessage('Template published.');
    } catch { if (seq === generation.current) { setAvailabilityUncertain(true); setError('Publication not confirmed. Choose Check availability before making further changes.'); } }
    finally { if (seq === generation.current) { saveLock.current = false; setBusy(false); } }
  };
  const createRevision = async () => {
    if (!template || template.status !== 'published' || busy || availabilityUncertain || availabilityLock.current || saveLock.current || pending || recoveryBlocked || !supabaseClient || !savedId.current) return;
    const seq = generation.current;
    saveLock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const { data, error: rpcError } = await supabaseClient.rpc('rev_vocational_create_revision', {
        target_workspace_id: workspaceId,
        target_template_id: savedId.current,
        expected_version: template.version,
      });
      if (seq !== generation.current) return;
      if (rpcError) throw rpcError;
      if (!data || typeof data.id !== 'string' || data.status !== 'draft' || Number(data.version) !== template.version + 1) {
        throw Error('Unexpected revision response.');
      }
      savedId.current = data.id;
      const draft: VocationalProfileTemplate = { ...template, id: data.id, version: Number(data.version), status: 'draft', publishedAt: undefined };
      const needsCore = coreVocationalQuestionCount(draft.sections) === 0;
      const editable = needsCore ? addCoreVocationalQuestions(draft) : draft;
      setTemplate(editable); setActiveId(editable.sections.find(section => coreVocationalQuestionCount([section]) > 0)?.id ?? editable.sections[0]?.id ?? '');
      setPreview(false); setDirty(needsCore);
      setMessage(needsCore ? 'Ready to edit. Suggested employment questions have been added for your review. Staff keep using the current questionnaire until you save and make these changes available.' : 'Ready to edit. Staff keep using the current questionnaire until you save and make your changes available.');
    } catch (cause) {
      if (seq === generation.current) setError(cause instanceof Error ? cause.message : 'Revision not confirmed. Reload before trying again.');
    } finally { if (seq === generation.current) { saveLock.current = false; setBusy(false); } }
  };

  const makeAvailable = async () => {
    if (!template || template.status !== 'draft' || pending || busy || availabilityLock.current || saveLock.current || recoveryBlocked || availabilityUncertain || !supabaseClient) return;
    if (!coreVocationalQuestionCount(template.sections)) { setError('Add suggested employment questions before making this questionnaire available.'); return; }
    const problems = validateVocationalTemplate(template);
    if (problems.length) { setError(problems.join(' ')); return; }
    const seq = generation.current;
    availabilityLock.current = true; setAvailabilityBusy(true); setError(''); setMessage('');
    try {
      const saved = dirty || !savedId.current ? await save() : {id: savedId.current, version: template.version};
      if (!saved || seq !== generation.current) return;
      saveLock.current = true; setBusy(true); setMessage('');
      const {data, error: rpcError} = await supabaseClient.rpc('publish_rev_vocational_template', {
        target_workspace_id: workspaceId, target_template_id: saved.id, expected_version: saved.version,
      });
      if (seq !== generation.current) return;
      if (rpcError || !data || data.id !== saved.id || data.status !== 'published') throw Error('Availability not confirmed');
      setTemplate(current => current?.id === saved.id ? {...current, status: 'published'} : current);
      setPreview(true); setAvailabilityUncertain(false);
      setMessage('Questionnaire is now available to assigned staff. Existing saved answers are unchanged.');
    } catch {
      if (seq === generation.current) { setAvailabilityUncertain(true); setError('Your questions were saved, but availability is not confirmed. Choose Check availability before making more changes.'); }
    } finally {
      if (seq === generation.current) { availabilityLock.current = false; saveLock.current = false; setAvailabilityBusy(false); setBusy(false); }
    }
  };

  const savedId = useRef<string | null>(null);


  function update(operation: (current: VocationalProfileTemplate) => VocationalProfileTemplate): boolean {
    if (!template || template.status !== 'draft' || busy || availabilityLock.current || availabilityUncertain || pending || recoveryBlocked) return false;
    try {
      setTemplate(operation(template)); setDirty(true); setMessage('');
      setError('');
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update template');
      return false;
    }
  }
  function addConvictionSentencingPreset() {
    if (!template || template.status !== 'draft' || busy || pending) return;
    const name = 'Conviction and Sentencing Information - Restricted';
    if (template.sections.some(s => s.title.trim().toLowerCase() === name.toLowerCase())) {
      setError('This section already exists. Select it in the section list.');
      return;
    }
    if (!window.confirm('This section is for authorised criminal justice programmes only. Do not collect real conviction or sentencing answers until restricted participant storage, access controls and retention rules are implemented. Add question definitions only?')) return;
    try {
      let next = addVocationalSection(template, name);
      const sectionId = next.sections[next.sections.length - 1].id;
      const questions: Array<{ label: string; type: VocationalFieldType; options?: string[] }> = [
        { label: 'Is conviction or sentencing information relevant to your employment support plan?', type: 'yes_no_prefer_not' },
        { label: 'Conviction category (only where necessary for the programme)', type: 'single_select', options: ['Violence', 'Sexual offence', 'Dishonesty or fraud', 'Drugs', 'Driving', 'Public order', 'Other', 'Prefer not to disclose'] },
        { label: 'Sentence type', type: 'single_select', options: ['Custodial sentence', 'Suspended sentence', 'Community order', 'Fine or discharge', 'Other', 'Prefer not to disclose'] },
        { label: 'Current status', type: 'single_select', options: ['In custody', 'On licence', 'Community supervision', 'Sentence completed', 'Other', 'Prefer not to disclose'] },
        { label: 'Relevant release or sentence completion date (only if needed)', type: 'date' },
        { label: 'Are there restrictions affecting work or training that an authorised adviser should discuss privately?', type: 'yes_no_prefer_not' },
        { label: 'Would you like confidential advice about criminal record disclosure to employers?', type: 'yes_no_prefer_not' },
      ];
      for (const question of questions) {
        next = addVocationalQuestion(next, sectionId, question.label, question.type, question.options ?? []);
        next = { ...next, sections: next.sections.map(section => section.id === sectionId ? {
          ...section, questions: section.questions.map((q, i) => i === section.questions.length - 1 ? { ...q, sensitive: true } : q)
        } : section) };
      }
      if (update(() => next)) {
        setActiveId(sectionId);
        setMessage('Restricted question definitions added. Do not use with participants until secure storage and permissions are implemented.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add restricted section.');
    }
  }

  function addResettlementPreset() {
    if (!template || template.status !== 'draft' || busy || pending) return;
    const name = 'Criminal Justice and Resettlement Support';
    if (template.sections.some(s => s.title.trim().toLowerCase() === name.toLowerCase())) {
      setError('This section already exists. Select it in the section list.');
      return;
    }
    try {
      let next = addVocationalSection(template, name);
      const sectionId = next.sections[next.sections.length - 1].id;
      const questions: Array<{ label: string; type: VocationalFieldType; options?: string[] }> = [
        { label: 'Would you like support preparing for employment?', type: 'yes_no_prefer_not' },
        { label: 'What support would help you prepare for work?', type: 'multi_select', options: ['CV and applications', 'Interview preparation', 'Training and qualifications', 'Travel planning', 'Identification or documents', 'Housing or practical support referral', 'Other support'] },
        { label: 'Would you like a confidential discussion with your adviser about employment disclosure requirements?', type: 'yes_no_prefer_not' },
        { label: 'Do you need help arranging work or training around existing appointments?', type: 'yes_no_prefer_not' },
        { label: 'What kind of work or training would you like to explore?', type: 'long_text' },
        { label: 'Would you like an adviser to contact you about resettlement support?', type: 'yes_no_prefer_not' },
      ];
      for (const question of questions) {
        next = addVocationalQuestion(next, sectionId, question.label, question.type, question.options ?? []);
      }
      if (update(() => next)) {
        setActiveId(sectionId);
        setMessage('Optional support questions added. Review them before saving.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add support section.');
    }
  }

  function changeSections(sections: VocationalProfileTemplate['sections']) {
    update(current => ({ ...current, sections: sections.map((s, order) => ({ ...s, order })), updatedAt: new Date().toISOString() }));
  }
  const recoveryWarning = recoveryBlocked && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Pending save recovery is unavailable. Do not start another save. Ask support to recover the retained request before editing or publishing.</p>;
  if (loading) return <p role="status">Loading vocational templates...</p>;
  if (!template) return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-xl font-semibold">Programme questionnaire</h2>
      <p className="text-sm text-slate-600">Choose the employment questions for this programme. Starter questions are ready for you to review.</p>
      <p className="text-sm text-slate-600">Assigned staff can use the questionnaire in their Service-user profiles once you make it available.</p>
      {error && <p role="alert" className="text-red-700">{error}</p>}
      {recoveryWarning}
      {pending && <button className={button} disabled={busy} onClick={() => void save(true)}>Retry pending save</button>}
      <button type="button" disabled={recoveryBlocked} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => {
        if (recoveryBlocked) return;
        try {
          const created = createVocationalTemplate(workspaceId, userId, programmeId);
          savedId.current = null; setTemplate(created); setDirty(true);
          setActiveId(created.sections.find(section => coreVocationalQuestionCount([section]) > 0)?.id ?? created.sections[0]?.id ?? '');
          setError('');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create template'); }
      }}>Set up questionnaire</button>
    </div>
  );

  const selected = template.sections.find(s => s.id === activeId) ?? template.sections[0];
  const coreQuestions = coreVocationalQuestionCount(template.sections);
  const totalQuestions = template.sections.reduce((sum, s) => sum + s.questions.length, 0);
  const errors = validateVocationalTemplate(template);

  return (
    <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-xl font-semibold">Programme questionnaire</h2><p className="text-sm text-slate-600">The questions assigned Employment Specialists use with their Service users.</p></div>
        <button type="button" className={button} disabled={availabilityBusy || availabilityUncertain || template.status === 'published'} onClick={() => setPreview(p => !p)}>{template.status === 'published' ? 'Available to staff' : preview ? 'Back to editor' : 'Preview participant form'}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        {template.status === 'published' && <button type="button" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white" disabled={busy || Boolean(pending) || recoveryBlocked} onClick={() => void createRevision()}>Edit questionnaire</button>}
        {template.status === 'draft' && !availabilityUncertain && <button type="button" className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white" disabled={availabilityBusy || busy || Boolean(pending) || recoveryBlocked || coreQuestions === 0 || errors.length > 0} onClick={() => void makeAvailable()}>{availabilityBusy ? 'Saving and making available...' : 'Save and make available'}</button>}
        {availabilityUncertain && <button type="button" className={button} disabled={busy || availabilityBusy} onClick={() => void load(true, savedId.current ?? undefined)}>Check availability</button>}
      </div>
      <details className="rounded-lg border border-slate-200 p-3">
        <summary className="cursor-pointer font-medium">More options</summary>
        <button type="button" className={button} disabled={availabilityBusy || availabilityUncertain || busy || template.status !== 'draft' || Boolean(pending) || recoveryBlocked || !dirty} onClick={() => void save()}>{busy ? 'Working...' : 'Save draft'}</button>
        <button type="button" className={button} disabled={availabilityBusy || availabilityUncertain || busy || template.status !== 'draft' || Boolean(pending) || recoveryBlocked || dirty || !savedId.current || coreQuestions === 0 || errors.length > 0} onClick={() => void publish()}>Publish template</button>
        <button type="button" className={button} disabled={availabilityBusy || busy || Boolean(pending) || dirty} onClick={() => void load(true)}>Reload saved template</button>
        <button type="button" className={`${button} mt-2`} disabled={availabilityBusy || availabilityUncertain || busy || Boolean(pending) || recoveryBlocked} onClick={() => {
          if (busy || pending || recoveryBlocked || saveLock.current || availabilityLock.current || availabilityUncertain) return;
          if (!window.confirm(dirty ? 'Discard unsaved edits and create a separate questionnaire? Saved questionnaires and answers remain unchanged.' : 'Create a separate questionnaire? Existing published questionnaires and answers remain available.')) return;
          const created = createVocationalTemplate(workspaceId, userId, programmeId);
          savedId.current = null; setTemplate(created); setActiveId(created.sections.find(section => coreVocationalQuestionCount([section]) > 0)?.id ?? created.sections[0]?.id ?? '');
          setPreview(false); setDirty(true); setError(''); setMessage('New questionnaire ready to edit. Choose Save and make available when ready.');
        }}>Create another questionnaire</button>
      </details>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        {template.status === 'published' ? <p>Staff can use this questionnaire. Choose Edit questionnaire to change the questions. More options lets you start a separate questionnaire. Existing published versions and participant answers remain available.</p> : <p>Review your questions, then choose Save and make available. REV takes care of saving and making the changes available to assigned Employment Specialists. Optional support questions are separate from core profile progress.</p>}

      </div>
      <div ref={feedback} tabIndex={-1} className="sticky top-4 z-10 rounded-lg bg-white focus:outline-none" aria-label="Questionnaire action feedback" aria-live="polite">
        {busy && <p role="status" className="rounded-lg border p-3 text-sm">Working on your questionnaire. Please wait for confirmation.</p>}
        {message && <p role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
        {error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>
      {pending && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">Save not confirmed. Do not edit or publish until resolved. <button type="button" className={button} disabled={busy} onClick={() => void save(true)}>Retry same save</button></div>}
      {recoveryWarning}
      {dirty && <p className="text-sm text-amber-700">Unsaved changes. Save before leaving this page.</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Sections</div><div className="text-xl font-semibold">{template.sections.length}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Questions</div><div className="text-xl font-semibold">{totalQuestions}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Core questions</div><div className="text-xl font-semibold">{coreQuestions}</div></div>
        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Status</div><div className="text-sm font-semibold">{template.status === 'published' ? 'Available to staff' : dirty ? 'Unsaved changes' : 'Not yet available to staff'}</div></div>
      </div>
      <label className="block space-y-1 text-sm font-medium">Questionnaire name
        <input className={field} value={template.title} disabled={availabilityBusy || availabilityUncertain || template.status === 'published' || busy || Boolean(pending) || recoveryBlocked} onChange={e => update(t => ({ ...t, title: e.target.value, updatedAt: new Date().toISOString() }))} />
      </label>
      {coreQuestions === 0 && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">This questionnaire has no core employment questions. Employment Specialists cannot complete a core profile from it. {template.status === 'published' ? 'Choose Edit questionnaire to review suggested questions, then Save and make available.' : 'Add core employment questions before publishing. Optional or restricted support questions do not count as core questions.'}</p>}
      {errors.length > 0 && <div role="status" className="text-sm text-amber-700">{errors.slice(0, 3).map((message, i) => <p key={i}>{message}</p>)}</div>}
      {preview || template.status === 'published' ? (
        <div className="space-y-4"><h3 className="text-lg font-semibold">{template.title || 'Untitled profile'} - Participant preview</h3><p className="text-sm text-slate-500">Preview only. Answers are not recorded.</p>
          {template.sections.map(s => <section className="space-y-3 rounded-lg border border-slate-200 p-4" key={s.id}><h4 className="font-semibold">{s.title}</h4>{s.questions.length === 0 && <p className="text-sm text-slate-500">No questions in this section.</p>}{s.questions.map(q => <PreviewQuestion key={q.id} question={q} />)}</section>)}
        </div>
      ) : (
        <fieldset disabled={availabilityBusy || availabilityUncertain || busy || Boolean(pending) || recoveryBlocked} className="grid gap-5 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <aside className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Profile sections</h3>
            <div className="space-y-1">{template.sections.map((s, index) => (
              <button type="button" key={s.id} onClick={() => setActiveId(s.id)} aria-pressed={selected?.id === s.id} className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-sm ${selected?.id === s.id ? 'border-slate-500 bg-white font-semibold' : 'border-transparent hover:bg-white'}`}><span>{index + 1}. {s.title}</span><span className="text-xs text-slate-500">{s.questions.length}</span></button>
            ))}</div>
            {template.status === 'draft' && (
              <div className="space-y-2 border-t border-slate-200 pt-3">
                <button type="button" className={button} onClick={() => {
                  const before = coreVocationalQuestionCount(template.sections);
                  const next = addCoreVocationalQuestions(template);
                  if (update(() => next)) {
                    setActiveId(next.sections.find(section => coreVocationalQuestionCount([section]) > 0)?.id ?? activeId);
                    setMessage(coreVocationalQuestionCount(next.sections) > before ? 'Suggested employment questions added. Review them, then choose Save and make available.' : 'Core starter questions are already present.');
                  }
                }}>Add suggested questions</button>
                <button type="button" className={button} disabled={availabilityBusy || availabilityUncertain || busy || Boolean(pending)} onClick={addResettlementPreset}>Add optional resettlement support section</button>
                <button type="button" className={button} disabled={availabilityBusy || availabilityUncertain || busy || Boolean(pending)} onClick={addConvictionSentencingPreset}>Add restricted conviction and sentencing section</button>
                <p className="text-xs text-slate-600">Support needs only. Do not enter convictions, sentence details, licence conditions, or other criminal-offence information here. Restricted records require a separate authorised workflow.</p>
              </div>
            )}
            <div className="space-y-2 border-t border-slate-200 pt-3"><label className="block text-xs font-medium">New section title</label><input className={field} value={newSection} onChange={e => setNewSection(e.target.value)} placeholder="e.g. Self-employment" /><button type="button" className={button} onClick={() => {
              if (!newSection.trim()) { setError('Enter a section title'); return; }
              try {
                const next = addVocationalSection(template, newSection);
                if (!update(() => next)) return;
                setActiveId(next.sections[next.sections.length - 1].id);
                setNewSection('');
                setError(''); setMessage('Section added. Add its questions, then choose Save and make available.');
              } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add section'); }
            }}>+ Add section</button></div>
          </aside>
          <main className="min-w-0 space-y-4 rounded-xl border border-slate-200 p-4">
            <h3 ref={sectionHeading} tabIndex={-1} className="font-semibold focus:outline-none">{selected?.title ?? 'Choose a section'}</h3>
            {!selected ? <p className="text-sm text-slate-500">Add a section to begin.</p> : <>
              <div className="space-y-2"><label className="block text-sm font-semibold">Section name</label><input className={field} aria-label="Selected section name" value={selected.title} onChange={e => changeSections(template.sections.map(s => s.id === selected.id ? { ...s, title: e.target.value } : s))} />
                <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={template.sections[0]?.id === selected.id} onClick={() => { const i = template.sections.findIndex(s => s.id === selected.id); const list = [...template.sections]; [list[i - 1], list[i]] = [list[i], list[i - 1]]; changeSections(list); }}>Move up</button><button type="button" className={button} disabled={template.sections[template.sections.length - 1]?.id === selected.id} onClick={() => { const i = template.sections.findIndex(s => s.id === selected.id); const list = [...template.sections]; [list[i + 1], list[i]] = [list[i], list[i + 1]]; changeSections(list); }}>Move down</button><button type="button" className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700" onClick={() => { if (!window.confirm(`Delete section "${selected.title}" and its questions?`)) return; const list = template.sections.filter(s => s.id !== selected.id); changeSections(list); setActiveId(list[0]?.id ?? ''); }}>Delete section</button></div>
              </div>
              <div className="space-y-3 border-t border-slate-200 pt-4"><h3 className="font-semibold">Questions in this section</h3>{selected.questions.length === 0 && <p className="text-sm text-slate-500">No questions yet. Add the first one below.</p>}
                {selected.questions.map(q => <div key={q.id} className="space-y-2 rounded-lg border border-slate-200 p-3"><input aria-label="Question wording" className={field} value={q.label} onChange={e => changeSections(template.sections.map(s => s.id === selected.id ? { ...s, questions: s.questions.map(item => item.id === q.id ? { ...item, label: e.target.value } : item) } : s))} /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-600">{types.find(t => t.value === q.type)?.label}</span><label className="text-xs"><input type="checkbox" checked={q.required} onChange={e => changeSections(template.sections.map(s => s.id === selected.id ? { ...s, questions: s.questions.map(item => item.id === q.id ? { ...item, required: e.target.checked } : item) } : s))} /> Required</label><button type="button" className="text-xs text-red-700" onClick={() => changeSections(template.sections.map(s => s.id === selected.id ? { ...s, questions: s.questions.filter(item => item.id !== q.id).map((item, order) => ({ ...item, order })) } : s))}>Remove question</button></div>
                 <label className="block space-y-1 text-xs">Job-matching field (optional)
                   <select className={field} aria-label={`Job-matching field for ${q.label}`} value={q.standardField ?? ''}
                     disabled={isRestrictedVocationalQuestion(selected.title, q)}
                     onChange={e => changeSections(template.sections.map(s => s.id === selected.id ? { ...s, questions: s.questions.map(item => item.id === q.id ? { ...item, standardField: (e.target.value || undefined) as VocationalStandardField | undefined } : item) } : s))}>
                     <option value="">Not used for job matching</option>
                     {vocationalStandardFields.map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
                   </select>
                   {isRestrictedVocationalQuestion(selected.title, q) && <span className="text-amber-800">Restricted content cannot be mapped.</span>}
                 </label></div>)}
               </div>
              <div className="space-y-3 rounded-lg bg-slate-50 p-4"><h3 className="font-semibold">Add question</h3><label className="block space-y-1 text-sm">Question wording<input className={field} value={questionLabel} onChange={e => setQuestionLabel(e.target.value)} placeholder="e.g. What type of work interests you?" /></label><label className="block space-y-1 text-sm">Answer type<select className={field} value={questionType} onChange={e => setQuestionType(e.target.value as VocationalFieldType)}>{types.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
                {(questionType === 'single_select' || questionType === 'multi_select') && <label className="block space-y-1 text-sm">Options (one per line)<textarea className={field} rows={4} value={optionsText} onChange={e => setOptionsText(e.target.value)} placeholder={'Construction\nRetail\nHospitality'} /></label>}
                <label className="block text-sm"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> Required question</label>
                 <label className="block space-y-1 text-sm">Job-matching field (optional)
                   <select className={field} value={standardField} disabled={isRestrictedVocationalQuestion(selected.title, { label: questionLabel, sensitive: false })} onChange={e => setStandardField(e.target.value as VocationalStandardField | '')}>
                     <option value="">Not used for job matching</option>
                     {vocationalStandardFields.map(value => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}
                   </select>
                 </label>
                <button type="button" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => {
                  if (!questionLabel.trim()) { setError('Enter the question wording'); return; }
                  if (update(t => {
                    const added = addVocationalQuestion(t, selected.id, questionLabel, questionType, optionsText.split(/\r?\n/));
                    return { ...added, sections: added.sections.map(s => s.id === selected.id ? { ...s, questions: s.questions.map((q, i) => i === s.questions.length - 1 ? { ...q, required, standardField: standardField && !isRestrictedVocationalQuestion(s.title, q) ? standardField : undefined } : q) } : s) };
                  })) { setQuestionLabel(''); setOptionsText(''); setRequired(false); setStandardField(''); setMessage('Question added. Choose Save and make available when ready.'); }
                }}>+ Add question</button>
              </div>
            </>}
          </main>
        </fieldset>
      )}
    </div>
  );
}

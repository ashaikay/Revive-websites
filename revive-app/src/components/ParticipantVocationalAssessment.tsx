import { useEffect, useRef, useState } from 'react';
import { coreVocationalSections } from '../domain/vocationalCore';
import { supabaseClient } from '@/data/supabaseClient';
import { VocationalStatusPanel } from './VocationalStatusPanel';
import { VocationalConsentManager } from './VocationalConsentManager';

type Question = { id: string; label: string; description?: string; type: string; required: boolean; sensitive: boolean; options?: string[] };
type Section = { id: string; title: string; questions: Question[] };
type Snapshot = { id: string; template_id: string; version: number; title: string; sections: Section[]; published_at: string };
type Assessment = { assessmentId: string; version: number; status: string; answers: Record<string, unknown> };
// The core employment profile never requires disclosure of criminal justice,
// safeguarding or other sensitive information. Optional support requires a
// separate consented workflow and must not be mixed into the ordinary answers RPC.
const optionalSupportSection = /criminal justice|resettlement|conviction|sentenc|offen[cs]e|prison|probation|safeguard|inclusive employment support/i;
const ordinarySections = coreVocationalSections;
const hasOptionalSupportSection = (sections: Section[]) => sections.some((section) => optionalSupportSection.test(section.title));
const answered = (value: unknown) => value !== undefined && value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);

export function ParticipantVocationalAssessment({ workspaceId, programmeId, participantId, participantName, caseReference, assignedSpecialists = [], isManager = false, consentAdvisers = [], onReviewQuestionnaire }: { workspaceId: string; programmeId: string; participantId: string; participantName?: string; caseReference?: string; assignedSpecialists?: string[]; isManager?: boolean; consentAdvisers?: { userId: string; label: string }[]; onReviewQuestionnaire?: () => void }) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState('');
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [refreshStatus,setRefreshStatus]=useState(0);
  const [completing,setCompleting]=useState(false);
  const [expandedSection,setExpandedSection]=useState<string | null>(null);
  const [showHelp,setShowHelp]=useState(false);
  const [showMissing,setShowMissing]=useState(false);
  const scopeKey = JSON.stringify([workspaceId, programmeId, participantId, selected]);
  // A fresh token also distinguishes leaving a profile and returning to it.
  // Late replies must not change another profile's answers, feedback, or busy state.
  const scope = useRef({ key: scopeKey, token: Symbol() });
  // Lock synchronously, before React has rendered the disabled write controls.
  const write = useRef<symbol | null>(null);
  if (scope.current.key !== scopeKey) {
    scope.current = { key: scopeKey, token: Symbol() };
    write.current = null;
  }
  useEffect(() => { setSaving(false); setCompleting(false); }, [scopeKey]);
  useEffect(() => () => { scope.current.token = Symbol(); write.current = null; }, []);
  useEffect(() => {
    setOpen(false); setSnapshots([]); setSelected(''); setAssessment(null); setAnswers({});
    setDirty(false); setError(''); setNotice(''); setLoading(false);
    setRefreshStatus(0); setExpandedSection(null); setShowMissing(false); setShowHelp(false);
  }, [workspaceId, programmeId, participantId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    async function load() {
      setLoading(true); setError('');
      try {
        if (!supabaseClient) throw new Error('Database connection unavailable.');
        const { data: templates, error: te } = await supabaseClient.from('programme_hub_vocational_templates')
          .select('id').eq('workspace_id', workspaceId).eq('programme_id', programmeId).eq('status', 'published');
        if (te) throw te;
        const ids = (templates ?? []).map((t) => t.id as string);
        if (!ids.length) { if (active) setSnapshots([]); return; }
        const { data, error: ve } = await supabaseClient.from('programme_hub_vocational_template_versions')
          .select('id,template_id,version,title,sections,published_at').eq('workspace_id', workspaceId)
          .in('template_id', ids).order('published_at', { ascending: false }).limit(100);
        if (ve) throw ve;
        if (!active) return;
        const values = (data ?? []).filter((v) => Array.isArray(v.sections)) as Snapshot[];
        setSnapshots(values);
        setSelected((prev) => values.some((v) => v.id === prev) ? prev : values[0]?.id ?? '');
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Unable to load questionnaires.'); }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [open, workspaceId, programmeId]);
  useEffect(() => {
    if (!open || !selected) return;
    let active = true;
    async function loadAssessment() {
      setLoading(true); setAssessment(null); setAnswers({}); setDirty(false); setNotice(''); setError('');
      try {
        if (!supabaseClient) throw new Error('Database connection unavailable.');
        const { data, error: rpcError } = await supabaseClient.rpc('rev_voc_assessment_draft', {
          target_workspace_id: workspaceId, target_programme_id: programmeId, target_participant_id: participantId,
          target_template_version_id: selected, target_action: 'open', target_assessment_id: null,
          expected_version: null, target_answers: {},
        });
        if (rpcError) throw rpcError;
        const result = data as Assessment;
        if (active) { setAssessment(result); setAnswers(result.answers ?? {}); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Unable to open assessment.'); }
      finally { if (active) setLoading(false); }
    }
    void loadAssessment();
    return () => { active = false; };
  }, [open, selected, workspaceId, programmeId, participantId]);
  const snapshot = snapshots.find((v) => v.id === selected);
  const sections = snapshot ? ordinarySections(snapshot.sections) : [];
  const optionalSupportAvailable = snapshot ? hasOptionalSupportSection(snapshot.sections) : false;
  const allQuestions = sections.flatMap(s => s.questions);
  const unanswered = allQuestions.filter(q => !answered(answers[q.id]));
  const requiredMissing = unanswered.filter(q => q.required);
  // Core completion deliberately excludes sensitive and restricted questions.
  // The percentage is an answer-progress indicator, not a substitute for server completion.
  const coreAnswered = allQuestions.length - unanswered.length;
  const coreProgressPercent = allQuestions.length ? Math.round((coreAnswered / allQuestions.length) * 100) : 0;
  const setAnswer = (id: string, value: unknown) => { setAnswers((previous) => ({ ...previous, [id]: value })); setDirty(true); setNotice(''); };
  const save = async () => {
    if (!assessment || !snapshot || !supabaseClient || saving || completing || write.current || !dirty) return;
    const scopeToken = scope.current.token;
    const writeToken = Symbol();
    write.current = writeToken;
    const current = () => scope.current.token === scopeToken && write.current === writeToken;
    setSaving(true); setError(''); setNotice('');
    try {
      const payload: Record<string, unknown> = {};
      for (const section of sections) for (const q of section.questions) {
        if (Object.prototype.hasOwnProperty.call(answers, q.id)) payload[q.id] = answers[q.id];
      }
      const { data, error: rpcError } = await supabaseClient.rpc('rev_voc_assessment_draft', {
        target_workspace_id: workspaceId, target_programme_id: programmeId, target_participant_id: participantId,
        target_template_version_id: selected, target_action: 'save', target_assessment_id: assessment.assessmentId,
        expected_version: assessment.version, target_answers: payload,
      });
      if (!current()) return;
      if (rpcError) throw rpcError;
      const result = data as Assessment;
      setAssessment(result); setAnswers(result.answers ?? {}); setDirty(false); setRefreshStatus(v=>v+1); setNotice('Draft saved. You can return to this assessment later.');
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : 'Save failed. Your unsaved answers remain on this screen.'); }
    finally { if (current()) { write.current = null; setSaving(false); } }
  };
  const complete = async () => {
    if(!assessment || !supabaseClient || saving || completing || write.current || dirty || assessment.status==='completed' || sections.length===0)return;
    if(requiredMissing.length) { setShowMissing(true); setExpandedSection(sections.find(s => s.questions.some(q => requiredMissing.some(m => m.id === q.id)))?.id ?? null); setError(`${requiredMissing.length} required question(s) remain unanswered. Open the highlighted section and save before completing.`); return; }
    if(!window.confirm('Mark this vocational assessment as completed? This will lock the assessment.'))return;
    const scopeToken = scope.current.token;
    const writeToken = Symbol();
    write.current = writeToken;
    const current = () => scope.current.token === scopeToken && write.current === writeToken;
    setCompleting(true);setError('');setNotice('');
    try {
      const {data,error:rpcError}=await supabaseClient.rpc('rev_voc_assessment_complete',{
        target_workspace_id:workspaceId,target_programme_id:programmeId,target_participant_id:participantId,
        target_assessment_id:assessment.assessmentId,expected_version:assessment.version
      });
      if(!current())return;
      if(rpcError)throw rpcError;
      const result=data as {version:number;status:string};
      setAssessment(prev=>prev?{...prev,version:result.version,status:result.status}:prev);
      setRefreshStatus(v=>v+1);setNotice('Vocational assessment marked completed.');
    }catch(cause){if(current())setError(cause instanceof Error?cause.message:'Completion failed.');}
    finally{if(current()){write.current=null;setCompleting(false);}}
  };
  const renderQuestion = (q: Question) => {
    const value = answers[q.id];
    const readOnly = assessment?.status === 'completed' || loading || saving || completing;
    const common = 'mt-1 w-full rounded border border-neutral-300 p-2';
    if (q.type === 'long_text') return <textarea disabled={readOnly} className={common} rows={3} value={String(value ?? '')} onChange={(e) => setAnswer(q.id, e.target.value)} />;
    if (q.type === 'short_text' || q.type === 'date' || q.type === 'number') return <input disabled={readOnly} className={common} type={q.type === 'date' ? 'date' : q.type === 'number' ? 'number' : 'text'} value={value == null ? '' : String(value)} onChange={(e) => setAnswer(q.id, q.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)} />;
    if (q.type === 'checkbox') return <input disabled={readOnly} className="ml-2" type="checkbox" checked={value === true} onChange={(e) => setAnswer(q.id, e.target.checked)} />;
    if (q.type === 'single_select' || q.type === 'yes_no_prefer_not') {
      const options = q.type === 'yes_no_prefer_not' ? ['yes', 'no', 'prefer_not_to_say'] : (q.options ?? []);
      return <select disabled={readOnly} className={common} value={String(value ?? '')} onChange={(e) => setAnswer(q.id, e.target.value || null)}><option value="">Select an answer</option>{options.map((opt) => <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>)}</select>;
    }
    if (q.type === 'multi_select') return <div className="mt-1 space-y-1">{(q.options ?? []).map((opt) => {
      const current = Array.isArray(value) ? value as string[] : [];
      return <label key={opt} className="flex items-center gap-2"><input disabled={readOnly} type="checkbox" checked={current.includes(opt)} onChange={(e) => setAnswer(q.id, e.target.checked ? [...current, opt] : current.filter((item) => item !== opt))} />{opt}</label>;
    })}</div>;
    return <span className="text-amber-700">Unsupported question type.</span>;
  };
  return <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Vocational assessment">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-lg font-semibold text-neutral-900">Vocational profile</h3>
        <p className="text-base text-neutral-700">{participantName || 'Service user'}{caseReference ? ` · ${caseReference}` : ''}</p></div>
      <button type="button" className="btn-secondary" disabled={saving || completing} aria-expanded={open} onClick={() => { if (open && dirty && !window.confirm('Discard unsaved answers?')) return; setOpen(!open); }}>
        {open ? 'Close profile' : 'Open profile'}
      </button>
    </div>
    {open && <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-base text-neutral-700">Assigned ES: {assignedSpecialists.length ? assignedSpecialists.join(', ') : 'Not assigned'}</span>
        <button type="button" className="btn-secondary" aria-expanded={showHelp} onClick={() => setShowHelp(v => !v)} aria-label="How vocational profiles work">Help</button>
      </div>
      {showHelp && <p className="rounded-lg bg-neutral-50 p-3 text-base text-neutral-800">This profile is linked to the service user shown above. Save answers as you go. Assigned Employment Specialists complete the profile; managers oversee progress. Access is controlled by the programme permissions.</p>}
      {assessment && !loading && <VocationalStatusPanel key={`${selected}:${assessment.assessmentId}`} workspaceId={workspaceId} programmeId={programmeId} participantId={participantId} assessmentId={assessment.assessmentId} refresh={refreshStatus} />}
      {error && <p role="alert" className="text-base text-red-700">{error}</p>}
      {notice && <p role="status" className="text-base text-green-700">{notice}</p>}
      {loading && <p role="status" className="text-base">Loading profile...</p>}
      {!loading && !error && snapshots.length === 0 && <p className="text-base">No published questionnaire is available for this programme.</p>}
      {snapshots.length > 0 && <details className="rounded-lg border border-neutral-200 p-3">
        <summary className="cursor-pointer text-base font-medium">Questionnaire version</summary>
        <select aria-label="Published questionnaire version" className="mt-2 w-full rounded border border-neutral-300 p-2 text-base" value={selected} disabled={loading || saving || completing} onChange={(e) => { if (dirty && !window.confirm('Discard unsaved answers and switch questionnaire?')) return; setSelected(e.target.value); setExpandedSection(null); }}>
          {snapshots.map((v) => <option key={v.id} value={v.id}>{v.title} · version {v.version}</option>)}
        </select>
      </details>}
      {assessment && !loading && isManager && <VocationalConsentManager key={assessment.assessmentId} assessmentId={assessment.assessmentId} advisers={consentAdvisers} />}
      {assessment && !loading && <>
        {allQuestions.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3">
          <div className="min-w-0 flex-1">
            <span className="text-base font-medium text-neutral-800">Core vocational profile: {coreProgressPercent}% · {unanswered.length} unanswered · {requiredMissing.length} required</span>
            <div role="progressbar" aria-label="Core vocational profile answer progress" aria-valuenow={coreProgressPercent} aria-valuemin={0} aria-valuemax={100} className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
              <div className="h-full bg-blue-600" style={{ width: `${coreProgressPercent}%` }} />
            </div>
          </div>
          <button type="button" className="btn-secondary" onClick={() => { setShowMissing(v => !v); if (!showMissing && unanswered.length) setExpandedSection(sections.find(s => s.questions.some(q => !answered(answers[q.id])))?.id ?? null); }}>{showMissing ? 'Show all questions' : 'Show unanswered questions'}</button>
        </div>}
        {optionalSupportAvailable && <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3" role="note">
          <p className="text-base font-medium text-neutral-900">Optional inclusive employment support</p>
          <p className="mt-1 text-base text-neutral-700">This programme has a separate criminal justice or resettlement support section. It is excluded from core profile progress and ordinary matching. Participants do not need to disclose convictions or other sensitive information to complete their core vocational profile. Sensitive support must use a separately authorised, consented workflow; it is not collected on this screen.</p>
        </div>}
        {sections.length === 0 && <div role="status" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">
          <p>This published questionnaire has no core employment questions. Its optional support questions do not form a complete vocational profile. A manager needs to publish a reviewed revision with core questions.</p>
          {isManager && onReviewQuestionnaire ? <button type="button" className="btn-secondary" onClick={onReviewQuestionnaire}>Review programme questionnaire</button> : <button type="button" className="btn-secondary" onClick={async () => {
            try { await navigator.clipboard.writeText('Please review the vocational questionnaire for my programme. The published version has no core employment questions. Create a draft revision, add core questions, save and publish it.'); setNotice('Setup request copied. Send it to your programme manager. No notification has been sent automatically.'); }
            catch { setNotice('Copy unavailable. Tell your programme manager that the published questionnaire needs core employment questions.'); }
          }}>Copy setup request for manager</button>}
        </div>}
        {sections.length > 0 && <p className="text-base text-neutral-700">Selected published version: {snapshot?.version}. {allQuestions.length} core {allQuestions.length === 1 ? 'question' : 'questions'} across {sections.length} {sections.length === 1 ? 'section' : 'sections'}. Draft changes are not included.</p>}
        {dirty && <p className="text-base font-medium text-amber-800">Unsaved changes</p>}
        <div className="space-y-2">{sections.map((section) => {
          const expanded = expandedSection === section.id;
          return <section key={section.id} className="overflow-hidden rounded-lg border border-neutral-200">
            <button type="button" className="flex w-full items-center justify-between gap-3 bg-neutral-50 px-4 py-3 text-left text-base font-semibold" aria-expanded={expanded} onClick={() => setExpandedSection(expanded ? null : section.id)}>
              <span>{section.title} · {section.questions.filter(q => answered(answers[q.id])).length} of {section.questions.length} answered{section.questions.some(q => q.required && !answered(answers[q.id])) ? ' · Required answers missing' : ''}</span><span aria-hidden="true">{expanded ? '−' : '+'}</span>
            </button>
            {expanded && <div className="space-y-5 p-4">{section.questions.filter(q => !showMissing || !answered(answers[q.id])).map((q) => <div key={q.id} className={`text-base ${q.required && !answered(answers[q.id]) ? 'rounded-lg border-l-4 border-amber-500 bg-amber-50 p-3' : ''}`}>
              <label className="block font-medium">{q.label}{q.required ? ' (required)' : ''}{renderQuestion(q)}</label>
              {q.description && <p className="mt-1 text-base text-neutral-700">{q.description}</p>}
            </div>)}{showMissing && section.questions.every(q => answered(answers[q.id])) && <p className="text-base text-green-700">All questions in this section have answers.</p>}</div>}
          </section>;
        })}</div>
        {assessment.status !== 'completed' && sections.length > 0 && <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" className="btn-primary" disabled={!dirty || saving || completing} onClick={() => void save()}>{saving ? 'Saving...' : 'Save progress'}</button>
          <button type="button" className="btn-secondary" disabled={dirty || saving || completing} onClick={() => void complete()}>{completing ? 'Completing...' : 'Mark completed'}</button>
        </div>}
        {assessment.status === 'completed' && <p className="text-base font-medium text-green-700">Assessment completed · Read-only</p>}
        {dirty && <p className="text-base text-neutral-700">Save progress before marking completed.</p>}
      </>}
    </div>}
  </section>;
}

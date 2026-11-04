import { useEffect, useRef, useState } from 'react';
import { supabaseClient } from '@/data/supabaseClient';
import { reviewProgrammeVacancy, type ProfileField, type ProgrammeVacancyReview } from '@/services/revBrainOpportunityFoundation';
import { parseProgrammeOpportunityReview, type OpportunityReadiness, type ProgrammeOpportunityReview } from '@/services/revBrainOpportunityReview';

type ReviewState = { status: 'closed' } | { status: 'loading' } | { status: 'failed'; message: string } | { status: 'loaded'; review: ProgrammeOpportunityReview };

const notReady: Record<Exclude<OpportunityReadiness, 'ready'>, string> = {
  no_published_questionnaire: 'Not ready: this programme has no published vocational questionnaire. A manager needs to publish one before opportunities can be reviewed.',
  reassessment_required: 'Not ready: the current questionnaire has not been started for this Service user. Answers to earlier questionnaires are not used.',
  assessment_in_progress: 'Not ready: the current questionnaire is still in progress. Complete it to review opportunities. Unfinished and earlier answers are not used.',
};
const fieldLabels: Record<ProfileField, string> = {
  skills: 'Skills answer', qualifications: 'Qualifications answer', preferredSectors: 'Preferred sector answer', preferredLocations: 'Preferred location answer',
};
const profileRows: [keyof ProgrammeOpportunityReview['profileEvidence']['summary'], string][] = [
  ['employmentGoals', 'Employment goals'], ['preferredSectors', 'Preferred sectors'], ['skills', 'Skills'], ['qualifications', 'Qualifications'], ['preferredLocations', 'Preferred locations'],
];
const formatDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'date unknown' : date.toLocaleDateString('en-GB'); };

export function ParticipantOpportunityReview({ workspaceId, userId, programmeId, participantId }: {
  workspaceId: string; userId: string; programmeId: string; participantId: string;
}) {
  const [state, setState] = useState<ReviewState>({ status: 'closed' });
  const [reload, setReload] = useState(0);
  const scopeKey = `${workspaceId}|${userId}|${programmeId}|${participantId}`;
  const scope = useRef({ key: scopeKey, token: Symbol() });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, token: Symbol() };
  useEffect(() => { setState({ status: 'closed' }); }, [scopeKey]);
  const open = state.status !== 'closed';

  useEffect(() => {
    if (state.status !== 'loading') return;
    const token = scope.current.token;
    (async () => {
      try {
        if (!supabaseClient) throw new Error('unavailable');
        const { data, error } = await supabaseClient.rpc('rev_brain_programme_opportunity_review', {
          target_workspace_id: workspaceId, target_programme_id: programmeId, target_participant_id: participantId,
        });
        if (error) throw error;
        const review = parseProgrammeOpportunityReview(data);
        if (scope.current.token === token) setState({ status: 'loaded', review });
      } catch (cause) {
        if (scope.current.token !== token) return;
        const code = typeof cause === 'object' && cause && 'code' in cause ? String((cause as { code: unknown }).code) : '';
        setState({ status: 'failed', message: code === '42501' ? 'You do not have access to review opportunities for this Service user.'
          : cause instanceof Error && cause.message === 'Opportunity review could not be verified.' ? cause.message
            : 'Opportunities could not be loaded. Nothing has been changed.' });
      }
    })();
  }, [state.status, reload, workspaceId, programmeId, participantId]);

  const load = () => { setState({ status: 'loading' }); setReload((value) => value + 1); };
  const review = state.status === 'loaded' ? state.review : null;
  const reviews = review?.status === 'ready'
    ? review.opportunities.map((opportunity) => ({ opportunity, assessment: reviewProgrammeVacancy(review.profileEvidence.summary, opportunity) }))
      .sort((a, b) => b.assessment.supportedMatches.length - a.assessment.supportedMatches.length
        || (a.assessment.requiredTotal - a.assessment.requiredEvidenced) - (b.assessment.requiredTotal - b.assessment.requiredEvidenced)
        || a.opportunity.title.localeCompare(b.opportunity.title))
    : [];


  const noEvidence = review?.status === 'ready' && review.profileEvidence.mappedQuestionCount === 0;
  return <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Opportunity review">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-neutral-900">Opportunities</h3>
        <p className="text-base text-neutral-700">Programme jobs compared with the current questionnaire.</p>
      </div>
      <button type="button" className={`rev-outcomes-profile-action ${open ? 'btn-secondary' : 'btn-primary'}`} aria-expanded={open}
        onClick={() => (open ? setState({ status: 'closed' }) : load())}>{open ? 'Close opportunities' : 'Review opportunities'}</button>
    </div>
    {open && <div className="mt-4 space-y-4" aria-live="polite">
      <p className="text-sm text-neutral-700">Staff review only. Nothing is applied for, sent or added to the action plan.</p>
      {state.status === 'loading' && <p role="status" className="text-base">Loading opportunities...</p>}
      {state.status === 'failed' && <div role="alert" className="space-y-2 text-base text-red-700"><p>{state.message}</p>
        <button type="button" className="btn-secondary" onClick={load}>Try again</button></div>}
      {review && review.status !== 'ready' && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">{notReady[review.status]}</p>}
      {review && review.status === 'ready' && <>
        <p role="status" className="text-base">{reviews.length === 0 ? 'No active jobs are recorded for this programme.'
          : `${reviews.length} ${reviews.length === 1 ? 'job' : 'jobs'} to review.`}</p>
        {noEvidence && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">Matching evidence is unavailable from the current questionnaire. This does not mean the Service user lacks these skills.</p>}
        {review.truncated && <p className="text-sm text-amber-800">Showing {review.opportunities.length} of {review.opportunityCount} active jobs.</p>}
        <details className="rounded-lg border border-neutral-200 p-3">
          <summary className="cursor-pointer font-medium">Details</summary>
          <div className="mt-2 space-y-2 text-sm text-neutral-700">
            <div aria-label="Profile evidence">
              <p>Profile evidence: completed current questionnaire only ({review.profileEvidence.mappedQuestionCount} matching {review.profileEvidence.mappedQuestionCount === 1 ? 'answer' : 'answers'}). Restricted answers, sensitive information and case notes are not used.</p>
              <dl className="mt-1 grid gap-1 md:grid-cols-2">{profileRows.map(([field, label]) => <div key={field}><dt className="inline font-medium">{label}: </dt>
                <dd className="inline">{review.profileEvidence.summary[field].length ? review.profileEvidence.summary[field].join(', ') : 'Not available to matching'}</dd></div>)}</dl>
            </div>
            <div aria-label="Opportunity sources">
              <p>Opportunity sources: programme job records. External vacancy search is not available yet.</p>
              <p>Jobs with more evidenced requirements are listed first. This order is not a likelihood of employment. Requirements are matched by exact wording, so similar skills described differently are not recognised.</p>
            </div>
          </div>
        </details>
        {reviews.length > 0 && <ul className="space-y-3" aria-label="Programme jobs">{reviews.map(({ opportunity, assessment }) =>
          <li key={opportunity.source.vacancyId} className="rounded-lg border border-neutral-200 p-3">
            <h4 className="font-semibold">{opportunity.title}</h4>
            <p className="text-sm text-neutral-700">{opportunity.employerName}</p>
            <OpportunityDetail assessment={assessment}
              sourceDetail={`Programme job record, updated ${formatDate(opportunity.source.updatedAt)}`} />
          </li>)}</ul>}
      </>}
    </div>}
  </section>;
}

const listText = (items: string[]) => items.join(', ');

function OpportunityDetail({ assessment, sourceDetail }: { assessment: ProgrammeVacancyReview; sourceDetail: string }) {
  const supported = assessment.supportedMatches.map((match) => match.requirement);
  const gaps = assessment.missingEvidence.map((gap) => gap.requirement);
  return <div className="mt-2 space-y-1 text-sm">
    <p className="font-medium">{assessment.requiredTotal ? `Evidence for ${assessment.requiredEvidenced} of ${assessment.requiredTotal} required skills` : 'Required skills not specified'}</p>
    <p><span className="font-medium">Supported:</span> {supported.length ? listText(supported) : 'None evidenced yet'}</p>
    {gaps.length > 0 && <p><span className="font-medium">Not yet evidenced:</span> {listText(gaps)}</p>}
    <details className="mt-1">
      <summary className="cursor-pointer font-medium">Details</summary>
      <div className="mt-2 space-y-2">
        <p>Source: {sourceDetail}</p>
        {assessment.supportedMatches.length > 0 && <div><h5 className="font-medium">Supported by the current questionnaire</h5>
          <ul className="list-disc pl-5">{assessment.supportedMatches.map((match) =>
            <li key={`${match.requirementType}-${match.requirement}`}>{match.requirementType}: {match.requirement} ({fieldLabels[match.profileField]})</li>)}</ul></div>}
        {assessment.missingEvidence.length > 0 && <div><h5 className="font-medium">Not yet evidenced</h5>
          <ul className="list-disc pl-5">{assessment.missingEvidence.map((gap) =>
            <li key={`${gap.requirementType}-${gap.requirement}`}>{gap.requirementType}: {gap.requirement}</li>)}</ul>
          <p>This means no matching questionnaire answer, not that the skill is absent.</p></div>}
        {assessment.uncertainty.length > 0 && <div><h5 className="font-medium">Limitations</h5>
          <ul className="list-disc pl-5">{assessment.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        <div><h5 className="font-medium">Suggested steps for staff</h5>
          <ul className="list-disc pl-5">{assessment.proposedNextSteps.map((item) => <li key={item}>{item}</li>)}</ul></div>
      </div>
    </details>
  </div>;
}

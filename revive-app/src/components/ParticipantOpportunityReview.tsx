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

  return <section className="mt-4 rounded-xl border border-neutral-200 bg-white p-4" aria-label="Opportunity review">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h3 className="text-lg font-semibold text-neutral-900">Opportunities</h3>
        <p className="text-base text-neutral-700">Review existing jobs from this programme against the current questionnaire.</p>
      </div>
      <button type="button" className={`rev-outcomes-profile-action ${open ? 'btn-secondary' : 'btn-primary'}`} aria-expanded={open}
        onClick={() => (open ? setState({ status: 'closed' }) : load())}>{open ? 'Close opportunities' : 'Review opportunities'}</button>
    </div>
    {open && <div className="mt-4 space-y-4">
      <p className="rounded-lg bg-neutral-50 p-3 text-sm text-neutral-800">For staff review only. Nothing is applied for, sent, or added to the action plan. The Service user decides which opportunities to pursue.</p>
      {state.status === 'loading' && <p role="status" className="text-base">Loading opportunities...</p>}
      {state.status === 'failed' && <div role="alert" className="space-y-2 text-base text-red-700"><p>{state.message}</p>
        <button type="button" className="btn-secondary" onClick={load}>Try again</button></div>}
      {review && review.status !== 'ready' && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-base text-amber-900">{notReady[review.status]}</p>}
      {review && review.status === 'ready' && <>
        <div className="rounded-lg border border-neutral-200 p-3" aria-label="Profile evidence">
          <h4 className="font-semibold">Profile evidence</h4>
          <p className="text-sm text-neutral-700">From the completed current questionnaire only ({review.profileEvidence.mappedQuestionCount} matching {review.profileEvidence.mappedQuestionCount === 1 ? 'answer' : 'answers'}). Restricted answers, sensitive information and case notes are not used.</p>
          <dl className="mt-2 grid gap-1 text-sm md:grid-cols-2">{profileRows.map(([field, label]) => <div key={field}><dt className="inline font-medium">{label}: </dt>
            <dd className="inline">{review.profileEvidence.summary[field].length ? review.profileEvidence.summary[field].join(', ') : 'Not recorded'}</dd></div>)}</dl>
        </div>
        <div className="text-sm text-neutral-700" aria-label="Opportunity sources">
          <p><span className="font-medium">Opportunity sources:</span> Programme job records (included). External vacancy search is not available yet.</p>
          <p>Jobs with more evidenced requirements are listed first. This order is not a likelihood of employment. Requirements are compared by their exact wording, so similar skills described differently are not recognised.</p>
        </div>
        {reviews.length === 0 && <p role="status" className="text-base">No active jobs are recorded for this programme.</p>}
        {review.truncated && <p role="status" className="text-sm text-amber-800">Showing {review.opportunities.length} of {review.opportunityCount} active jobs.</p>}
        {reviews.length > 0 && <ul className="space-y-3" aria-label="Programme jobs">{reviews.map(({ opportunity, assessment }) =>
          <li key={opportunity.source.vacancyId} className="rounded-lg border border-neutral-200 p-3">
            <h4 className="font-semibold">{opportunity.title}</h4>
            <p className="text-sm text-neutral-700">{opportunity.employerName} - Source: programme job record, updated {formatDate(opportunity.source.updatedAt)}</p>
            <p className="mt-1 text-sm">{assessment.requiredTotal ? `${assessment.requiredEvidenced} of ${assessment.requiredTotal} required skills have questionnaire evidence.` : 'No required skills listed.'}</p>
            <OpportunityDetail assessment={assessment} />
          </li>)}</ul>}
      </>}
    </div>}
  </section>;
}

function OpportunityDetail({ assessment }: { assessment: ProgrammeVacancyReview }) {
  return <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
    <div><h5 className="font-medium">Supported by the current questionnaire</h5>
      {assessment.supportedMatches.length ? <ul className="list-disc pl-5">{assessment.supportedMatches.map((match) =>
        <li key={`${match.requirementType}-${match.requirement}`}>{match.requirementType}: {match.requirement} ({fieldLabels[match.profileField]})</li>)}</ul> : <p>No listed requirement is supported yet.</p>}</div>
    <div><h5 className="font-medium">Missing evidence</h5>
      {assessment.missingEvidence.length ? <ul className="list-disc pl-5">{assessment.missingEvidence.map((gap) =>
        <li key={`${gap.requirementType}-${gap.requirement}`}>{gap.requirementType}: {gap.requirement}</li>)}</ul> : <p>None for the listed skills.</p>}</div>
    {assessment.uncertainty.length > 0 && <div><h5 className="font-medium">Uncertain</h5>
      <ul className="list-disc pl-5">{assessment.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    <div><h5 className="font-medium">Possible next steps for staff</h5>
      <ul className="list-disc pl-5">{assessment.proposedNextSteps.map((item) => <li key={item}>{item}</li>)}</ul></div>
  </div>;
}

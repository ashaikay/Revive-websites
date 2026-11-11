// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ParticipantOpportunityReview } from '@/components/ParticipantOpportunityReview';
import { reviewProgrammeVacancy, type ProgrammeVacancyOpportunity } from '@/services/revBrainOpportunityFoundation';
import { parseProgrammeOpportunityReview } from '@/services/revBrainOpportunityReview';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/data/supabaseClient', () => ({ supabaseClient: { rpc: (...args: unknown[]) => mocks.rpc(...args) } }));

const props = { workspaceId: 'workspace', userId: 'es-1', programmeId: 'programme', participantId: 'alice' };
const summary = { employmentGoals: ['Full-time employment'], preferredSectors: ['Warehousing'], skills: ['Forklift', 'Teamwork'], qualifications: ['First aid'], preferredLocations: [] };
const emptySummary = { employmentGoals: [], preferredSectors: [], skills: [], qualifications: [], preferredLocations: [] };
const vacancy = (overrides: Partial<ProgrammeVacancyOpportunity> = {}): ProgrammeVacancyOpportunity => ({
  source: { kind: 'programme_vacancy', vacancyId: 'vac-1', recordVersion: 3, updatedAt: '2026-11-01T10:00:00Z' },
  title: 'Warehouse operative', employerName: 'Acme Logistics', employerSector: 'Warehousing', workArea: 'Leeds',
  requiredSkills: ['forklift', 'Stock control'], desiredSkills: ['First aid'], ...overrides,
});
const response = (overrides: Record<string, unknown> = {}) => ({
  status: 'ready',
  profileEvidence: { source: 'current_vocational_questionnaire', templateVersionId: 'v2', assessmentId: 'a2', mappedQuestionCount: 3, unmappedQuestions: [], summary },
  opportunities: [vacancy()], opportunityCount: 1, truncated: false, ...overrides,
});
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Review opportunities' }));

beforeEach(() => mocks.rpc.mockReset());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('programme vacancy reasoning', () => {
  it('separates supported matches, missing evidence, uncertainty and next steps without a score', () => {
    const review = reviewProgrammeVacancy(summary, vacancy());
    expect(review.supportedMatches).toEqual([
      { requirement: 'forklift', requirementType: 'Required skill', profileField: 'skills' },
      { requirement: 'First aid', requirementType: 'Helpful skill', profileField: 'qualifications' },
      { requirement: 'Warehousing', requirementType: 'Sector', profileField: 'preferredSectors' },
    ]);
    expect(review.missingEvidence).toEqual([{ requirement: 'Stock control', requirementType: 'Required skill' }]);
    expect(review.uncertainty).toEqual(['Travel to Leeds has not been assessed.']);
    expect(review.proposedNextSteps).toEqual([
      'Discuss this job with the Service user and confirm whether they want to pursue it.',
      'Check evidence for Stock control. It may exist but is not recorded in the current questionnaire.',
      'Check travel to Leeds.',
      'If the Service user chooses to pursue it, record the agreed steps in the employment action plan.',
    ]);
    expect({ evidenced: review.requiredEvidenced, total: review.requiredTotal }).toEqual({ evidenced: 1, total: 2 });
    expect(review).not.toHaveProperty('score');
  });

  it('flags missing job details and sector differences as uncertainty', () => {
    const review = reviewProgrammeVacancy(summary, vacancy({ requiredSkills: [], desiredSkills: [], employerSector: 'Retail', workArea: null }));
    expect(review.uncertainty).toEqual([
      'No required skills are listed for this job, so it cannot be checked against them.',
      "The employer sector (Retail) is not one of the recorded preferred sectors; check the Service user's interest.",
      'The work area is not recorded for this job.',
    ]);
    expect(reviewProgrammeVacancy(emptySummary, vacancy({ employerSector: null })).uncertainty).toContain('The employer sector is not recorded.');
  });
});

describe('opportunity review response', () => {
  it('rejects malformed responses and opportunities returned before readiness', () => {
    expect(() => parseProgrammeOpportunityReview(response({ status: 'assessment_in_progress' }))).toThrow('could not be verified');
    expect(() => parseProgrammeOpportunityReview(response({ status: 'unknown' }))).toThrow('could not be verified');
    expect(() => parseProgrammeOpportunityReview(response({ opportunities: [{ ...vacancy(), requiredSkills: null }] }))).toThrow('could not be verified');
    expect(() => parseProgrammeOpportunityReview(response({ profileEvidence: { source: 'current_vocational_questionnaire', templateVersionId: 'v2', assessmentId: 'a2', mappedQuestionCount: 3, unmappedQuestions: [{ questionId: 'q1', label: null }], summary } }))).toThrow('could not be verified');
  });

  it('keeps only the allowlisted profile fields', () => {
    const parsed = parseProgrammeOpportunityReview(response({ profileEvidence: { source: 'current_vocational_questionnaire', templateVersionId: 'v2', assessmentId: 'a2', mappedQuestionCount: 3, unmappedQuestions: [], summary: { ...summary, healthNotes: ['restricted'] } } }));
    expect(Object.keys(parsed.profileEvidence.summary).sort()).toEqual(['employmentGoals', 'preferredLocations', 'preferredSectors', 'qualifications', 'skills']);
  });
});

describe('Review opportunities', () => {
  it('loads programme jobs on request and explains evidence without likelihood claims or actions', async () => {
    mocks.rpc.mockResolvedValue({ data: response(), error: null });
    render(<ParticipantOpportunityReview {...props} />);
    expect(mocks.rpc).not.toHaveBeenCalled();
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Loading opportunities...');
    const job = within(await screen.findByRole('list', { name: 'Programme jobs' })).getAllByRole('listitem')[0];
    expect(mocks.rpc).toHaveBeenCalledWith('rev_brain_programme_opportunity_review', { target_workspace_id: 'workspace', target_programme_id: 'programme', target_participant_id: 'alice' });
    expect(job).toHaveTextContent('Warehouse operative');
    expect(job).toHaveTextContent('Source: programme job record, updated 01/11/2026');
    expect(job).toHaveTextContent('1 of 2 required skills evidenced · 3 supported · 1 to check');
    const details = within(job).getByText('Details').closest('details');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('Missing evidence does not mean the Service user lacks a skill');
    expect(details).toHaveTextContent('Required skill: forklift (Skills answer)');
    expect(details).toHaveTextContent('Required skill: Stock control');
    expect(details).toHaveTextContent('Travel to Leeds has not been assessed.');
    expect(screen.getByLabelText('Profile evidence')).toHaveTextContent('Skills: Forklift, Teamwork');
    expect(screen.getByLabelText('Opportunity sources')).toHaveTextContent('External vacancy search is not available yet.');
    expect(screen.getByText(/not a likelihood of employment/)).toBeInTheDocument();
    expect(screen.queryByText(/%|score|likely to get/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /apply|send|add to action plan|place/i })).not.toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('shows unmapped ordinary questions without treating absent evidence as absent skills', async () => {
    mocks.rpc.mockResolvedValue({ data: response({
      profileEvidence: {
        source: 'current_vocational_questionnaire', templateVersionId: 'v2', assessmentId: 'a2',
        mappedQuestionCount: 0,
        unmappedQuestions: [{ questionId: 'experience', label: 'Tell us about your work experience' }],
        summary: emptySummary,
      },
    }), error: null });
    render(<ParticipantOpportunityReview {...props} />);
    open();
    const evidence = await screen.findByLabelText('Profile evidence');
    expect(evidence).toHaveTextContent('0 supported matching answers');
    expect(evidence).toHaveTextContent('This does not mean the Service user is missing skills or qualifications.');
    expect(evidence).toHaveTextContent('1 answered question is not mapped for opportunity matching');
    expect(evidence).toHaveTextContent('Tell us about your work experience');
    expect(evidence).toHaveTextContent('Saved answers and the published questionnaire have not been changed.');
  });

  it.each([
    ['assessment_in_progress', 'current questionnaire is still in progress'],
    ['reassessment_required', 'Answers to earlier questionnaires are not used'],
    ['no_published_questionnaire', 'no published vocational questionnaire'],
  ])('shows not ready for %s without listing jobs', async (status, text) => {
    mocks.rpc.mockResolvedValue({ data: response({ status, opportunities: [], opportunityCount: 0, profileEvidence: { source: 'current_vocational_questionnaire', templateVersionId: null, assessmentId: null, mappedQuestionCount: 0, unmappedQuestions: [], summary: emptySummary } }), error: null });
    render(<ParticipantOpportunityReview {...props} />);
    open();
    expect(await screen.findByText(new RegExp(text))).toHaveTextContent(/^Not ready/);
    expect(screen.queryByRole('list', { name: 'Programme jobs' })).not.toBeInTheDocument();
    expect(screen.queryByText('No active jobs are recorded for this programme.')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Profile evidence')).not.toBeInTheDocument();
  });

  it('distinguishes no opportunities from a read failure, and retries after failure', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error('Network failure') });
    render(<ParticipantOpportunityReview {...props} />);
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('Opportunities could not be loaded. Nothing has been changed.');
    expect(screen.queryByText('No active jobs are recorded for this programme.')).not.toBeInTheDocument();
    mocks.rpc.mockResolvedValueOnce({ data: response({ opportunities: [], opportunityCount: 0 }), error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No active jobs are recorded for this programme.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports denied access and unverifiable responses as read failures', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } });
    render(<ParticipantOpportunityReview {...props} />);
    open();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to review opportunities for this Service user.');
    mocks.rpc.mockResolvedValueOnce({ data: response({ status: 'reassessment_required' }), error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Opportunity review could not be verified.');
  });

  it('closes and ignores a stale response when the Service user changes', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mocks.rpc.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }));
    const view = render(<ParticipantOpportunityReview {...props} />);
    open();
    view.rerender(<ParticipantOpportunityReview {...props} participantId="bob" />);
    resolveFirst({ data: response(), error: null });
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Review opportunities' })).toBeInTheDocument();
    expect(screen.queryByText('Warehouse operative')).not.toBeInTheDocument();
  });
});

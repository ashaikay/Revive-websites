import type { OrdinaryVocationalSummary, ProgrammeVacancyOpportunity } from './revBrainOpportunityFoundation';

export type OpportunityReadiness = 'ready' | 'no_published_questionnaire' | 'reassessment_required' | 'assessment_in_progress';
export interface UnmappedVocationalQuestion { questionId: string; label: string }
export interface ProgrammeOpportunityReview {
  status: OpportunityReadiness;
  profileEvidence: {
    source: 'current_vocational_questionnaire';
    templateVersionId: string | null;
    assessmentId: string | null;
    mappedQuestionCount: number;
    unmappedQuestions: UnmappedVocationalQuestion[];
    summary: OrdinaryVocationalSummary;
  };
  opportunities: ProgrammeVacancyOpportunity[];
  opportunityCount: number;
  truncated: boolean;
}

const statuses: OpportunityReadiness[] = ['ready', 'no_published_questionnaire', 'reassessment_required', 'assessment_in_progress'];
const summaryFields: (keyof OrdinaryVocationalSummary)[] = ['employmentGoals', 'preferredSectors', 'skills', 'qualifications', 'preferredLocations'];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');
const isOptionalString = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isUnmappedQuestion = (value: unknown): value is UnmappedVocationalQuestion =>
  isRecord(value) && typeof value.questionId === 'string' && typeof value.label === 'string';
const invalid = () => new Error('Opportunity review could not be verified.');

export function parseProgrammeOpportunityReview(value: unknown): ProgrammeOpportunityReview {
  if (!isRecord(value) || !statuses.includes(value.status as OpportunityReadiness)) throw invalid();
  const evidence = value.profileEvidence;
  if (!isRecord(evidence) || evidence.source !== 'current_vocational_questionnaire' || !isRecord(evidence.summary)
    || !isOptionalString(evidence.templateVersionId) || !isOptionalString(evidence.assessmentId)
    || !Number.isInteger(evidence.mappedQuestionCount) || !Array.isArray(evidence.unmappedQuestions)
    || !evidence.unmappedQuestions.every(isUnmappedQuestion)) throw invalid();
  const raw = evidence.summary;
  if (!summaryFields.every((field) => isStrings(raw[field]))) throw invalid();
  const summary = Object.fromEntries(summaryFields.map((field) => [field, raw[field]])) as unknown as OrdinaryVocationalSummary;
  if (!Array.isArray(value.opportunities) || !Number.isInteger(value.opportunityCount) || typeof value.truncated !== 'boolean') throw invalid();
  // Older or in-progress answers must never produce opportunities.
  if (value.status !== 'ready' && value.opportunities.length) throw invalid();
  const opportunities = value.opportunities.map((item): ProgrammeVacancyOpportunity => {
    if (!isRecord(item) || !isRecord(item.source) || item.source.kind !== 'programme_vacancy'
      || typeof item.source.vacancyId !== 'string' || !Number.isInteger(item.source.recordVersion) || typeof item.source.updatedAt !== 'string'
      || typeof item.title !== 'string' || typeof item.employerName !== 'string'
      || !isOptionalString(item.employerSector) || !isOptionalString(item.workArea)
      || !isStrings(item.requiredSkills) || !isStrings(item.desiredSkills)) throw invalid();
    return {
      source: { kind: 'programme_vacancy', vacancyId: item.source.vacancyId, recordVersion: item.source.recordVersion as number, updatedAt: item.source.updatedAt },
      title: item.title, employerName: item.employerName, employerSector: item.employerSector, workArea: item.workArea,
      requiredSkills: item.requiredSkills, desiredSkills: item.desiredSkills,
    };
  });
  return {
    status: value.status as OpportunityReadiness,
    profileEvidence: {
      source: 'current_vocational_questionnaire', templateVersionId: evidence.templateVersionId, assessmentId: evidence.assessmentId,
      mappedQuestionCount: evidence.mappedQuestionCount as number,
      unmappedQuestions: evidence.unmappedQuestions.map((question) => ({
        questionId: question.questionId as string, label: question.label as string,
      })),
      summary,
    },
    opportunities, opportunityCount: value.opportunityCount as number, truncated: value.truncated,
  };
}

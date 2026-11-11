export type VocationalFieldType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'single_select'
  | 'multi_select'
  | 'checkbox'
  | 'yes_no_prefer_not';

export type VocationalTemplateStatus =
  | 'draft'
  | 'published'
  | 'archived';

export type VocationalStandardField =
  | 'employment_goal'
  | 'preferred_sector'
  | 'skills'
  | 'qualifications'
  | 'work_history'
  | 'availability'
  | 'travel_radius'
  | 'employment_status';

export const vocationalStandardFields: readonly VocationalStandardField[] = [
  'employment_goal', 'preferred_sector', 'skills', 'qualifications',
  'work_history', 'availability', 'travel_radius', 'employment_status',
] as const;

export const vocationalMatchingFields = [
  'employment_goal', 'preferred_sector', 'skills', 'qualifications',
] as const satisfies readonly VocationalStandardField[];

export type VocationalMatchingField = typeof vocationalMatchingFields[number];

export const vocationalMatchingFieldLabels: Record<VocationalMatchingField, string> = {
  employment_goal: 'Employment goals',
  preferred_sector: 'Preferred sectors',
  skills: 'Skills',
  qualifications: 'Qualifications',
};

export const vocationalMatchingOptions: Record<VocationalMatchingField, readonly string[]> = {
  employment_goal: [
    'Full-time employment', 'Part-time employment', 'Apprenticeship',
    'Traineeship', 'Self-employment', 'Work experience',
  ],
  preferred_sector: [
    'Construction', 'Retail', 'Warehousing', 'Logistics', 'Hospitality',
    'Health and social care', 'Administration', 'Customer service',
    'Manufacturing', 'Transport', 'Cleaning', 'Security', 'IT', 'Education',
    'Rail', 'Postal services', 'Traffic management',
  ],
  skills: [
    'Customer service', 'Communication', 'Teamwork', 'Time management',
    'IT skills', 'Microsoft Office', 'Forklift', 'Warehouse operations',
    'Stock control', 'Driving', 'Food preparation', 'Cleaning',
    'Construction labouring', 'Traffic management', 'Administration',
    'Cash handling', 'Sales', 'Manual handling',
  ],
  qualifications: [
    'CSCS card', 'Driving licence', 'Forklift licence', 'First aid',
    'Food hygiene', 'GCSE English', 'GCSE Maths', 'Functional Skills English',
    'Functional Skills Maths', 'SIA licence', 'NVQ Level 2', 'NVQ Level 3',
  ],
};

// Defence in depth for draft editing. The server must independently enforce
// the same restrictions before persisting templates or creating match summaries.
const restrictedVocationalTerms = /conviction|sentenc|offen[cs]e|prison|probation|criminal|health|disabilit|medical|diagnos|medicat|safeguard|ethnic|religio|sexual|contact|address|date of birth|dob|national insurance|housing|benefit|support need|barrier/i;
export function isRestrictedVocationalQuestion(sectionTitle: string, question: Pick<VocationalQuestion, 'label' | 'sensitive'>): boolean {
  return question.sensitive || restrictedVocationalTerms.test(sectionTitle) || restrictedVocationalTerms.test(question.label);
}

const matchingCandidateTerms = /\b(skills?|experience|qualifications?|training|sectors?|industr(?:y|ies)|career|job|role|occupation)\b|employment\s+(?:goal|aspiration|outcome)|(?:kind|type)\s+of\s+work|work\s+(?:interest|preference)|work\s+(?:would|do)\s+you\s+(?:like|want|prefer|explore)/i;
const nonMatchingQuestionTerms = /\b(contact|phone|email|address|date of birth|dob|national insurance|emergency contact|next of kin|support|help|barrier|housing|benefit|appointment|childcare|personal detail)/i;
export function isVocationalMatchingCandidate(
  section: Pick<VocationalSection, 'title' | 'description'>,
  question: Pick<VocationalQuestion, 'label' | 'description' | 'sensitive'>
): boolean {
  const sectionText = `${section.title} ${section.description ?? ''}`;
  const questionText = `${question.label} ${question.description ?? ''}`;
  return !isRestrictedVocationalQuestion(sectionText, question)
    && !nonMatchingQuestionTerms.test(`${sectionText} ${questionText}`)
    && matchingCandidateTerms.test(`${sectionText} ${questionText}`);
}

export function isVocationalMatchingField(value: VocationalStandardField | undefined): value is VocationalMatchingField {
  return vocationalMatchingFields.some((field) => field === value);
}

export interface VocationalQuestion {
  id: string;
  sectionId: string;
  label: string;
  description?: string;
  type: VocationalFieldType;
  required: boolean;
  order: number;
  options?: string[];
  standardField?: VocationalStandardField;
  sensitive: boolean;
}

export interface VocationalSection {
  id: string;
  title: string;
  description?: string;
  order: number;
  questions: VocationalQuestion[];
}

export interface VocationalProfileTemplate {
  id: string;
  workspaceId: string;
  programmeId: string | null;
  title: string;
  description?: string;
  version: number;
  status: VocationalTemplateStatus;
  sections: VocationalSection[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  createdBy: string;
}

export interface VocationalProfileAnswer {
  questionId: string;
  value: string | number | boolean | string[] | null;
}

export interface ParticipantVocationalProfile {
  id: string;
  workspaceId: string;
  programmeId: string;
  participantId: string;
  templateId: string;
  templateVersion: number;
  answers: VocationalProfileAnswer[];
  updatedAt: string;
  updatedBy: string;
}

export const defaultVocationalSections = [
  'Personal and contact information',
  'Employment goals and aspirations',
  'Work history',
  'Skills and experience',
  'Education and qualifications',
  'Preferred job sectors',
  'Availability and working hours',
  'Travel and transport',
  'Employment barriers and support needs',
  'Action planning and next steps',
] as const;

export function validateVocationalTemplate(
  template: VocationalProfileTemplate
): string[] {
  const errors: string[] = [];

  if (!template.workspaceId) {
    errors.push('Workspace is required');
  }

  if (!template.title.trim()) {
    errors.push('Template title is required');
  }

  if (template.version < 1 || !Number.isInteger(template.version)) {
    errors.push('Invalid template version');
  }

  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();

  for (const section of template.sections) {
    if (!section.title.trim()) {
      errors.push('Section title is required');
    }

    if (sectionIds.has(section.id)) {
      errors.push('Duplicate section ID');
    }

    sectionIds.add(section.id);

    for (const question of section.questions) {
      if (!question.label.trim()) {
        errors.push('Question label is required');
      }

      if (question.sectionId !== section.id) {
        errors.push('Question section mismatch');
      }

      if (questionIds.has(question.id)) {
        errors.push('Duplicate question ID');
      }

      questionIds.add(question.id);

      if (question.standardField !== undefined) {
        if (!vocationalStandardFields.includes(question.standardField)) {
          errors.push('Unknown standard field mapping');
        }
        if (isRestrictedVocationalQuestion(section.title, question)) {
          errors.push('Restricted questions cannot be mapped to job matching');
        }
      }

      if (
        ['single_select', 'multi_select'].includes(question.type) &&
        (!question.options || question.options.length === 0)
      ) {
        errors.push('Selection questions require options');
      }
    }
  }

  return errors;
}

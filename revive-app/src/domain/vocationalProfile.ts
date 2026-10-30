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

// Defence in depth for draft editing. The server must independently enforce
// the same restrictions before persisting templates or creating match summaries.
const restrictedVocationalTerms = /conviction|sentenc|offen[cs]e|prison|probation|criminal|health|disabilit|medical|diagnos|medicat|safeguard|ethnic|religio|sexual|contact|address|date of birth|dob|national insurance|housing|benefit|support need|barrier/i;
export function isRestrictedVocationalQuestion(sectionTitle: string, question: Pick<VocationalQuestion, 'label' | 'sensitive'>): boolean {
  return question.sensitive || restrictedVocationalTerms.test(sectionTitle) || restrictedVocationalTerms.test(question.label);
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

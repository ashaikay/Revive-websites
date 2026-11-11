import { isCoreVocationalQuestion } from './vocationalCore';
import {
  defaultVocationalSections,
  vocationalMatchingOptions,
  type VocationalFieldType,
  type VocationalProfileTemplate,
  type VocationalQuestion,
  type VocationalSection,
} from './vocationalProfile';

export function createVocationalTemplate(
  workspaceId: string,
  createdBy: string,
  programmeId: string | null = null
): VocationalProfileTemplate {
  const now = new Date().toISOString();

  const template: VocationalProfileTemplate = {
    id: crypto.randomUUID(),
    workspaceId,
    programmeId,
    title: 'Vocational Profile',
    description: '',
    version: 1,
    status: 'draft',
    sections: defaultVocationalSections.map((title, order) => ({
      id: crypto.randomUUID(),
      title,
      order,
      questions: [],
    })),
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  return addCoreVocationalQuestions(template);
}

function editable(template: VocationalProfileTemplate): void {
  if (template.status !== 'draft') {
    throw new Error('Only draft templates can be edited');
  }
}

export function renameVocationalTemplate(
  template: VocationalProfileTemplate,
  title: string
): VocationalProfileTemplate {
  editable(template);

  if (!title.trim()) throw new Error('Title is required');

  return {
    ...template,
    title: title.trim(),
    updatedAt: new Date().toISOString(),
  };
}

export function addVocationalSection(
  template: VocationalProfileTemplate,
  title: string
): VocationalProfileTemplate {
  editable(template);

  if (!title.trim()) throw new Error('Section title is required');

  const section: VocationalSection = {
    id: crypto.randomUUID(),
    title: title.trim(),
    order: template.sections.length,
    questions: [],
  };

  return {
    ...template,
    sections: [...template.sections, section],
    updatedAt: new Date().toISOString(),
  };
}

export function addVocationalQuestion(
  template: VocationalProfileTemplate,
  sectionId: string,
  label: string,
  type: VocationalFieldType,
  options: string[] = []
): VocationalProfileTemplate {
  editable(template);

  if (!label.trim()) throw new Error('Question label is required');

  if (!template.sections.some(s => s.id === sectionId)) {
    throw new Error('Section not found');
  }

  if (
    ['single_select', 'multi_select'].includes(type) &&
    options.filter(o => o.trim()).length === 0
  ) {
    throw new Error('Selection questions require options');
  }

  return {
    ...template,
    sections: template.sections.map(section => {
      if (section.id !== sectionId) return section;

      const question: VocationalQuestion = {
        id: crypto.randomUUID(),
        sectionId,
        label: label.trim(),
        type,
        required: false,
        order: section.questions.length,
        options: options.map(o => o.trim()).filter(Boolean),
        sensitive: false,
      };

      return {
        ...section,
        questions: [...section.questions, question],
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}


// Definitions only; no participant answers or saved templates are changed.
export function addCoreVocationalQuestions(template: VocationalProfileTemplate): VocationalProfileTemplate {
  editable(template);
  const starters: Array<{
    title: string; label: string; standardField?: import('./vocationalProfile').VocationalStandardField;
    type?: VocationalFieldType; options?: readonly string[];
  }> = [
    { title: 'Employment goals and aspirations', label: 'What employment outcome are you looking for?', standardField: 'employment_goal', type: 'single_select', options: vocationalMatchingOptions.employment_goal },
    { title: 'Work history', label: 'What work or volunteering have you done?', standardField: 'work_history' },
    { title: 'Skills and experience', label: 'Which skills would you like to use at work?', standardField: 'skills', type: 'multi_select', options: vocationalMatchingOptions.skills },
    { title: 'Education and qualifications', label: 'What qualifications or training have you completed?', standardField: 'qualifications', type: 'multi_select', options: vocationalMatchingOptions.qualifications },
    { title: 'Preferred job sectors', label: 'Which job sectors interest you?', standardField: 'preferred_sector', type: 'multi_select', options: vocationalMatchingOptions.preferred_sector },
    { title: 'Availability and working hours', label: 'What days and hours could you work?', standardField: 'availability' },
    { title: 'Travel and transport', label: 'How far could you travel for work?', standardField: 'travel_radius' },
    { title: 'Action planning and next steps', label: 'What is your next step towards employment?' },
  ];
  let next = template;
  for (const { title, label, standardField, type = 'long_text', options = [] } of starters) {
    if (next.sections.some(section => section.questions.some(question => isCoreVocationalQuestion(section, question) && (question.label === label || (standardField && question.standardField === standardField))))) continue;
    let section = next.sections.find(section => section.title.toLowerCase() === title.toLowerCase() && isCoreVocationalQuestion(section, {label, sensitive: false}));
    if (!section) { next = addVocationalSection(next, title); section = next.sections[next.sections.length - 1]; }
    next = addVocationalQuestion(next, section.id, label, type, [...options]);
    const sectionId = section.id;
    next = { ...next, sections: next.sections.map(section => section.id === sectionId ? {
      ...section, questions: section.questions.map((question, index) => index === section.questions.length - 1 ? { ...question, standardField } : question),
    } : section) };
  }
  return next;
}

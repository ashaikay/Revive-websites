import { isCoreVocationalQuestion } from './vocationalCore';
import {
  defaultVocationalSections,
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
  const starters: Array<[string, string, import('./vocationalProfile').VocationalStandardField | undefined]> = [
    ['Employment goals and aspirations', 'What kind of work would you like to do?', 'employment_goal'],
    ['Work history', 'What work or volunteering have you done?', 'work_history'],
    ['Skills and experience', 'Which skills would you like to use at work?', 'skills'],
    ['Education and qualifications', 'What qualifications or training have you completed?', 'qualifications'],
    ['Preferred job sectors', 'Which job sectors interest you?', 'preferred_sector'],
    ['Availability and working hours', 'What days and hours could you work?', 'availability'],
    ['Travel and transport', 'How far could you travel for work?', 'travel_radius'],
    ['Action planning and next steps', 'What is your next step towards employment?', undefined],
  ];
  let next = template;
  for (const [title, label, standardField] of starters) {
    if (next.sections.some(section => section.questions.some(question => isCoreVocationalQuestion(section, question) && (question.label === label || (standardField && question.standardField === standardField))))) continue;
    let section = next.sections.find(section => section.title.toLowerCase() === title.toLowerCase() && isCoreVocationalQuestion(section, {label, sensitive: false}));
    if (!section) { next = addVocationalSection(next, title); section = next.sections[next.sections.length - 1]; }
    next = addVocationalQuestion(next, section.id, label, 'long_text');
    const sectionId = section.id;
    next = { ...next, sections: next.sections.map(section => section.id === sectionId ? {
      ...section, questions: section.questions.map((question, index) => index === section.questions.length - 1 ? { ...question, standardField } : question),
    } : section) };
  }
  return next;
}

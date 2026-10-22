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

  return {
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

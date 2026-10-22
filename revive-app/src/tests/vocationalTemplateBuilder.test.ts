import { describe, expect, it } from 'vitest';
import {
  createVocationalTemplate,
  renameVocationalTemplate,
  addVocationalSection,
  addVocationalQuestion,
} from '../domain/vocationalTemplateBuilder';
import { validateVocationalTemplate } from '../domain/vocationalProfile';

describe('REV vocational template builder', () => {
  it('creates ten default sections', () => {
    const template = createVocationalTemplate('workspace-1', 'manager-1');
    expect(template.sections).toHaveLength(10);
    expect(template.status).toBe('draft');
    expect(template.workspaceId).toBe('workspace-1');
  });

  it('allows organisations to rename profiles', () => {
    const template = createVocationalTemplate('workspace-1', 'manager-1');
    const renamed = renameVocationalTemplate(template, 'Getting to Know You');
    expect(renamed.title).toBe('Getting to Know You');
  });

  it('allows custom sections and questions', () => {
    const template = createVocationalTemplate('workspace-1', 'manager-1');
    const updated = addVocationalSection(template, 'My Career Interests');
    const section = updated.sections[updated.sections.length - 1];

    const result = addVocationalQuestion(
      updated,
      section.id,
      'Which industries interest you?',
      'multi_select',
      ['Construction', 'Retail', 'Hospitality']
    );

    expect(result.sections[result.sections.length - 1].questions).toHaveLength(1);
    expect(validateVocationalTemplate(result)).toEqual([]);
  });

  it('rejects selection questions without options', () => {
    const template = createVocationalTemplate('workspace-1', 'manager-1');

    expect(() =>
      addVocationalQuestion(
        template,
        template.sections[0].id,
        'Choose a sector',
        'single_select'
      )
    ).toThrow();
  });

  it('prevents editing published templates', () => {
    const template = createVocationalTemplate('workspace-1', 'manager-1');

    expect(() =>
      renameVocationalTemplate(
        { ...template, status: 'published' },
        'Changed'
      )
    ).toThrow();
  });
});

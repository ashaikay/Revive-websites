import { describe, expect, it } from 'vitest';
import {
  createVocationalTemplate,
  renameVocationalTemplate,
  addVocationalSection,
  addVocationalQuestion,
  addCoreVocationalQuestions,
} from '../domain/vocationalTemplateBuilder';
import { coreVocationalQuestionCount } from '../domain/vocationalCore';
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

    expect(result.sections[result.sections.length - 1].questions).toHaveLength(section.questions.length + 1);
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


it('starts new drafts with eight ordinary employment questions and does not duplicate them', () => {
  const template = createVocationalTemplate('workspace', 'manager', 'programme');
  expect(coreVocationalQuestionCount(template.sections)).toBe(8);
  expect(template.sections.flatMap(section => section.questions).every(question => !question.sensitive && !question.required)).toBe(true);
  expect(addCoreVocationalQuestions(template).sections).toEqual(template.sections);
  expect(validateVocationalTemplate(template)).toEqual([]);
  expect(() => addCoreVocationalQuestions({...template,status:'published'})).toThrow();
});
it('adds core definitions to an optional-only draft without changing optional questions', () => {
  const template = createVocationalTemplate('workspace','manager');
  const support = {...template.sections[0],title:'Criminal Justice and Resettlement Support',questions:[{
    id:'support-question',sectionId:template.sections[0].id,label:'Would you like employment support?',type:'long_text' as const,required:false,order:0,sensitive:false,
  }]};
  const original = {...template,sections:[support]};
  expect(coreVocationalQuestionCount(original.sections)).toBe(0);
  const repaired = addCoreVocationalQuestions(original);
  expect(coreVocationalQuestionCount(repaired.sections)).toBe(8);
  expect(repaired.sections[0]).toEqual(support);
  expect(original.sections).toHaveLength(1);
});
it('excludes sensitive descriptions and optional support from core readiness', () => {
  const template = createVocationalTemplate('workspace','manager');
  const section=template.sections.find(section=>section.questions.length)!;
  expect(coreVocationalQuestionCount([{...section,description:'Medical information'}])).toBe(0);
  expect(coreVocationalQuestionCount([{...section,questions:section.questions.map(question=>({...question,label:'Have you been convicted?'}))}])).toBe(0);
  expect(coreVocationalQuestionCount([{...section,questions:section.questions.map(question=>({...question,sensitive:true}))}])).toBe(0);
});

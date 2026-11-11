import { describe, expect, it } from 'vitest';
import {
  createVocationalTemplate,
  renameVocationalTemplate,
  addVocationalSection,
  addVocationalQuestion,
  addCoreVocationalQuestions,
} from '../domain/vocationalTemplateBuilder';
import { coreVocationalQuestionCount } from '../domain/vocationalCore';
import {
  isVocationalMatchingCandidate, isVocationalMatchingField, validateVocationalTemplate,
  suggestVocationalMatchingField, vocationalMatchingFields, vocationalMatchingOptions,
} from '../domain/vocationalProfile';

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
it('gives future suggested employment-evidence questions supported mappings and approved options', () => {
  const template = createVocationalTemplate('workspace', 'manager', 'programme');
  const questions = template.sections.flatMap(section => section.questions);
  const mapped = questions.filter(question => vocationalMatchingFields.some(field => field === question.standardField));
  expect(mapped.map(question => question.standardField).sort()).toEqual([...vocationalMatchingFields].sort());
  for (const question of mapped) {
    if (!isVocationalMatchingField(question.standardField)) throw new Error('Expected supported matching field');
    expect(['single_select', 'multi_select']).toContain(question.type);
    expect(question.options).toEqual(vocationalMatchingOptions[question.standardField]);
  }
  expect(questions.find(question => question.standardField === 'work_history')?.type).toBe('long_text');
  expect(questions.find(question => question.standardField === 'availability')?.type).toBe('long_text');
});
it('identifies employment-evidence questions without treating personal, contact or support questions as matching setup', () => {
  const section = { title: 'Employment profile', description: undefined };
  const question = (label: string) => ({ label, description: undefined, sensitive: false });
  expect(isVocationalMatchingCandidate(section, question('Which skills would you like to use at work?'))).toBe(true);
  expect(isVocationalMatchingCandidate(section, question('Other supported skills'))).toBe(true);
  expect(isVocationalMatchingCandidate(section, question('Which skills would you like to learn?'))).toBe(false);
  expect(isVocationalMatchingCandidate(section, question('Which job sectors interest you?'))).toBe(true);
  expect(isVocationalMatchingCandidate(section, question('How should an employer contact you?'))).toBe(false);
  expect(isVocationalMatchingCandidate(section, question('What employment support would help?'))).toBe(false);
  expect(isVocationalMatchingCandidate({ title: 'Personal details' }, question('Preferred job role'))).toBe(false);
});
it('suggests only clear existing evidence and preference mappings', () => {
  const section = { title: 'Employment profile', description: undefined };
  const question = (label: string) => ({ label, description: undefined, sensitive: false });
  expect(suggestVocationalMatchingField(section, question('Which existing skills do you have?'))).toBe('skills');
  expect(suggestVocationalMatchingField(section, question('Which certificates or licences do you hold?'))).toBe('qualifications');
  expect(suggestVocationalMatchingField(section, question('What are your preferred job roles?'))).toBe('employment_goal');
  expect(suggestVocationalMatchingField(section, question('Which sectors are you interested in?'))).toBe('preferred_sector');
  expect(suggestVocationalMatchingField(section, question('Which skills would you like to learn?'))).toBeNull();
  expect(suggestVocationalMatchingField(section, question('What work interests you?'))).toBeNull();
  expect(suggestVocationalMatchingField(section, question('What employment support would help?'))).toBeNull();
  expect(suggestVocationalMatchingField(section, question('How should an employer contact you?'))).toBeNull();
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

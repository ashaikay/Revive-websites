// Core questions follow the ordinary-assessment privacy boundary. Optional
// support must remain outside core answers and completion percentages.
const restricted = /medical|diagnos|disabilit|mental[\s-]*health|safeguard|domestic[\s-]*abuse|ethnic|religio|sexual[\s-]*orient|gender[\s-]*identit|criminal|offen[cs]e|convict|sentenc|prison|probation|resettlement|restricted|substance[\s-]*misuse|addiction|pregnan|immigration[\s-]*status|nationalit|inclusive employment support/i;
type Question = { label: string; description?: string; sensitive: boolean };
type Section = { title: string; description?: string; questions: Question[] };
export function isCoreVocationalQuestion(section: Pick<Section, 'title' | 'description'>, question: Question) {
  return question.sensitive === false && !restricted.test(`${section.title} ${section.description ?? ''} ${question.label} ${question.description ?? ''}`);
}
export function coreVocationalSections<T extends Section>(sections: T[]): T[] {
  return sections.map(section => ({ ...section, questions: section.questions.filter(question => isCoreVocationalQuestion(section, question)) }))
    .filter(section => section.questions.length > 0);
}
export function coreVocationalQuestionCount(sections: Section[]) {
  return coreVocationalSections(sections).reduce((sum, section) => sum + section.questions.length, 0);
}

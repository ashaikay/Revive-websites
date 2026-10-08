// Mirrors rev_scheduling_private.skill_key in supabase/migrations/20261008000000_rev_scheduling_skill_matching.sql.
// Only ASCII whitespace and A–Z are normalised so browser and database agree exactly; labels are never rewritten.
const whitespace=/[ \t\n\v\f\r]+/g;
export function skillKey(tag:string):string{
 return tag.replace(whitespace,' ').replace(/^ | $/g,'').replace(/[A-Z]/g,letter=>letter.toLowerCase());
}
export function missingSkills(required:readonly string[],held:readonly string[]):string[]{
 const keys=new Set(held.map(skillKey));
 return required.filter(skill=>!keys.has(skillKey(skill)));
}
export const hasSkills=(required:readonly string[],held:readonly string[])=>missingSkills(required,held).length===0;

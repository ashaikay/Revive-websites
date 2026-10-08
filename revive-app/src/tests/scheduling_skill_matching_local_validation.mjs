// Local Supabase database only. Runs inside one transaction that is always rolled back.
import { spawnSync } from 'node:child_process';
import { skillKey } from '../services/skillMatching.ts';

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`${name}=${condition ? 'PASS' : 'FAIL'}${condition || !detail ? '' : ` (${detail})`}`);
  if (!condition) failures++;
}
function sql(statement) {
  const result = spawnSync('docker', ['exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', 'supabase_db_revive-app', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|'],
    { input: statement, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Local SQL validation failed; check Docker and the local migration.\n${result.stderr ?? ''}`);
  return result.stdout.trim();
}
const hex = value => Buffer.from(value, 'utf8').toString('hex');

// 1. Browser and database produce byte-identical keys.
const samples = ['Dsear & Fire', 'dsear & fire', '  DSEAR   &  fire  ', 'Dsear\t&\n\nFire', '\vDsear &\fFire\r', 'Dsear', 'Dsear\u00a0& Fire', 'ÉCLAIR', 'Fire  Marshal', 'A'];
const parity = sql(samples.map(sample => `select encode(convert_to(rev_scheduling_private.skill_key(convert_from(decode('${hex(sample)}','hex'),'UTF8')),'UTF8'),'hex');`).join('\n')).split('\n');
check('KEY_PARITY_BROWSER_DATABASE', parity.length === samples.length && samples.every((sample, i) => parity[i] === hex(skillKey(sample))), parity.join(','));

// 2. Real allocation guards.
const user = '0d000000-0000-4000-8000-000000000001', ws = '0d000000-0000-4000-8000-000000000002';
const W = n => `0d000000-0000-4000-8000-0000000001${n}`, J = n => `0d000000-0000-4000-8000-0000000002${n}`;
const start = '2026-11-13T10:00:00Z', end = '2026-11-13T15:00:00Z';
const workers = [
  ['10', 'Karol', ['DSEAR  &  fire'], '09:00', '17:00'],
  ['11', 'Dee', ['Dsear'], '09:00', '17:00'],
  ['12', 'Kate', ['DSEAR & FIRE'], '09:00', '17:00'],
  ['13', 'Lee', ['dsear & FIRE'], '09:00', '17:00'],
  ['14', 'Olly', ['Dsear & Fire'], '12:00', '17:00'],
  ['15', 'Owen', ['Dsear & fire'], '09:00', '17:00'],
  ['16', 'Tom', ['Dsear & Fire Level 2'], '09:00', '17:00'],
];
const arr = values => `array[${values.map(v => `'${v.replace(/'/g, "''")}'`).join(',')}]::text[]`;
const assign = (worker, job) => `pg_temp.attempt($q$insert into public.scheduling_assignments(workspace_id,worker_id,job_id,start_at,end_at,status,created_by_user_id,updated_by_user_id) values('${ws}','${W(worker)}','${J(job)}','${start}','${end}','active','${user}','${user}')$q$)`;
const output = sql(`
begin;
create function pg_temp.attempt(statement text) returns text language plpgsql as $f$
begin execute statement; return 'ok'; exception when others then return sqlerrm; end $f$;
insert into auth.users(id,email) values('${user}','skill-matching-${Date.now()}@example.test');
insert into public.workspaces(id,name,slug,created_by) values('${ws}','Skill matching','skill-matching-${Date.now()}','${user}');
insert into public.workspace_members(workspace_id,user_id,role,status) values('${ws}','${user}','owner','active');
${workers.map(([n, name, skills]) => `insert into public.scheduling_workers(id,workspace_id,display_name,skill_tags,active,created_by_user_id,updated_by_user_id) values('${W(n)}','${ws}','${name}',${arr(skills)},true,'${user}','${user}');`).join('\n')}
${workers.map(([n, , , from, to]) => `insert into public.scheduling_worker_patterns(workspace_id,worker_id,timezone,working_days,start_local,end_local,effective_from,updated_by_user_id) values('${ws}','${W(n)}','Europe/London','{1,2,3,4,5}','${from}','${to}','2026-10-01','${user}');`).join('\n')}
insert into public.scheduling_jobs(id,workspace_id,title,start_at,end_at,timezone,location,required_skills,staffing_count,status,created_by_user_id,updated_by_user_id) values
 ('${J('10')}','${ws}','assigned job','${start}','${end}','Europe/London','Cardiff',${arr(['Dsear & Fire'])},5,'open','${user}','${user}'),
 ('${J('11')}','${ws}','Other job','${start}','${end}','Europe/London','Cardiff','{}',5,'open','${user}','${user}'),
 ('${J('12')}','${ws}','Dsear only','${start}','${end}','Europe/London','Cardiff',${arr(['Dsear'])},5,'open','${user}','${user}');
select set_config('rev.authoritative_annual_leave','on',true);
insert into public.scheduling_worker_unavailability(workspace_id,worker_id,start_at,end_at,category,status,created_by_user_id,updated_by_user_id) values('${ws}','${W('13')}','${start}','${end}','leave','active','${user}','${user}');
select set_config('rev.authoritative_annual_leave','off',true);
select 'case_spacing_match|'||${assign('10', '10')};
select 'different_skill|'||${assign('11', '10')};
select 'no_substring|'||${assign('12', '12')};
select 'no_superstring|'||${assign('16', '10')};
select 'leave|'||${assign('13', '10')};
select 'hours|'||${assign('14', '10')};
select 'overlap_setup|'||${assign('15', '11')};
select 'overlap|'||${assign('15', '10')};
select 'labels|'||(select skill_tags::text from public.scheduling_workers where id='${W('10')}')||'|'||(select required_skills::text from public.scheduling_jobs where id='${J('10')}');
select 'worker_case_edit|'||pg_temp.attempt($q$update public.scheduling_workers set skill_tags=array['Dsear & Fire'],version=version+1 where id='${W('10')}'$q$);
select 'worker_skill_removed|'||pg_temp.attempt($q$update public.scheduling_workers set skill_tags=array['Dsear'],version=version+1 where id='${W('10')}'$q$);
rollback;
`);
const results = Object.fromEntries(output.split('\n').filter(line => line.includes('|')).map(line => { const [k, ...v] = line.split('|'); return [k, v.join('|')]; }));
check('CASE_AND_SPACING_EQUIVALENT_SKILL_ASSIGNS', results.case_spacing_match === 'ok', results.case_spacing_match);
check('DIFFERENT_SKILL_BLOCKED', results.different_skill === 'Required skills missing', results.different_skill);
check('SUBSTRING_NOT_ACCEPTED', results.no_substring === 'Required skills missing', results.no_substring);
check('LONGER_SKILL_NOT_ACCEPTED', results.no_superstring === 'Required skills missing', results.no_superstring);
check('LEAVE_STILL_ENFORCED', results.leave === 'Worker unavailable', results.leave);
check('WORKING_HOURS_STILL_ENFORCED', results.hours === 'Recorded working availability required', results.hours);
check('OVERLAP_STILL_ENFORCED', results.overlap_setup === 'ok' && results.overlap === 'Worker already assigned', `${results.overlap_setup}/${results.overlap}`);
check('SAVED_LABELS_UNCHANGED', results.labels === '{"DSEAR  &  fire"}|{"Dsear & Fire"}', results.labels);
check('WORKER_CASE_EDIT_KEEPS_ASSIGNMENT', results.worker_case_edit === 'ok', results.worker_case_edit);
check('WORKER_SKILL_REMOVAL_STILL_GUARDED', results.worker_skill_removed === 'Cancel affected assignments before changing worker', results.worker_skill_removed);
const leftover = sql(`select count(*) from public.workspaces where id='${ws}';`);
check('TRANSACTION_ROLLED_BACK', leftover === '0', leftover);
if (failures) { console.error(`${failures} skill matching check(s) failed.`); process.exit(1); }

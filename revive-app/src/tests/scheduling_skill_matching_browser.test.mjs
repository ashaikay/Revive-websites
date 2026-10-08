import test from 'node:test';import assert from 'node:assert/strict';
import {skillKey,missingSkills,hasSkills} from '../services/skillMatching.ts';
import {loadPlannerData,workerSuitability,assignmentConflict} from '../services/schedulingPlanner.ts';
const ws='11111111-1111-4111-8111-111111111111',worker='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',other='44444444-4444-4444-8444-444444444444',pattern='55555555-5555-4555-8555-555555555555',leave='66666666-6666-4666-8666-666666666666';
const start='2026-11-13T10:00:00.000Z',end='2026-11-13T15:00:00.000Z';
function rows(workerSkills,jobSkills=['Dsear & Fire']){return {scheduling_workers:[{id:worker,workspace_id:ws,display_name:'Karol',role_labels:[],skill_tags:workerSkills,active:true,version:1}],scheduling_jobs:[{id:job,workspace_id:ws,title:'assigned job',start_at:start,end_at:end,timezone:'Europe/London',location:'Cardiff',required_skills:jobSkills,staffing_count:1,status:'open',version:1},{id:other,workspace_id:ws,title:'Other job',start_at:start,end_at:end,timezone:'Europe/London',location:'Cardiff',required_skills:[],staffing_count:1,status:'open',version:1}],scheduling_assignments:[],scheduling_worker_patterns:[{id:pattern,workspace_id:ws,worker_id:worker,timezone:'Europe/London',working_days:[1,2,3,4,5],start_local:'09:00',end_local:'17:00',effective_from:'2026-10-01',effective_until:null,version:1}],scheduling_worker_unavailability:[]};}
const load=r=>loadPlannerData(ws,async table=>r[table]);
const reason=async(workerSkills,jobSkills,change=()=>{})=>{const d=await load(rows(workerSkills,jobSkills));change(d);return workerSuitability(d,d.jobs[0],d.workers[0]).reason;};

test('skill key ignores ASCII capitalisation, surrounding whitespace and repeated whitespace only',()=>{
 for(const value of ['Dsear & Fire','dsear & fire','DSEAR & FIRE','  Dsear   &  Fire  ','Dsear\t&\n\nFire','\vDsear &\fFire\r'])assert.equal(skillKey(value),'dsear & fire');
 assert.equal(skillKey('Dsear\u00a0& Fire'),'dsear\u00a0& fire');
 assert.equal(skillKey('ÉCLAIR'),'Éclair');
 assert.notEqual(skillKey('Dsear'),skillKey('Dsear & Fire'));
});

test('equivalent capitalisation and spacing match; labels are left as saved',async()=>{
 assert.deepEqual(missingSkills(['Dsear & Fire','Admin'],['ADMIN','dsear  &  fire']),[]);
 assert.equal(await reason(['DSEAR  &  fire'],['Dsear & Fire']),null);
 assert.equal(await reason(['dsear & fire'],['Dsear  &  FIRE']),null);
 const d=await load(rows(['DSEAR  &  fire']));assert.deepEqual(d.workers[0].skills,['DSEAR  &  fire']);assert.deepEqual(d.jobs[0].skills,['Dsear & Fire']);
});

test('genuinely different skills stay blocked with no substring, prefix or fuzzy matching',async()=>{
 for(const [held,required] of [[['Dsear'],['Dsear & Fire']],[['Dsear & Fire'],['Dsear']],[['Dsear & Fire Level 2'],['Dsear & Fire']],[['Dsear&Fire'],['Dsear & Fire']],[['Dsear\u00a0& Fire'],['Dsear & Fire']],[['Fire'],['Dsear & Fire']],[[],['Dsear & Fire']]]){
  assert.equal(hasSkills(required,held),false,`${held} vs ${required}`);
  assert.equal(await reason(held,required),'missing_skills',`${held} vs ${required}`);
 }
 assert.deepEqual(missingSkills(['Dsear & Fire','Admin'],['admin','Dsear']),['Dsear & Fire']);
});

test('matching skills never bypass hours, leave or overlap checks',async()=>{
 const same=['dsear  &  FIRE'];
 assert.equal(await reason(same,undefined,d=>{d.patterns[0].endLocal='11:00';}),'outside_working_availability');
 assert.equal(await reason(same,undefined,d=>{d.patterns=[];}),'no_working_pattern');
 assert.equal(await reason(same,undefined,d=>{d.leave=[{id:leave,workerId:worker,startAt:start,endAt:end,category:'leave',status:'active'}];}),'worker_unavailable');
 assert.equal(await reason(same,undefined,d=>{d.assignments=[{id:leave,workerId:worker,jobId:other,startAt:start,endAt:end,status:'active'}];}),'overlap');
 assert.equal(await reason(same,undefined,d=>{d.workers[0].active=false;}),'worker_inactive');
});

test('saved assignment review uses the same matching',async()=>{
 const d=await load(rows(['DSEAR & fire']));const a={id:leave,workerId:worker,jobId:job,startAt:start,endAt:end,status:'active'};d.assignments=[a];
 assert.equal(assignmentConflict(d,a),false);
 d.workers[0].skills=['Dsear'];assert.equal(assignmentConflict(d,a),true);
});

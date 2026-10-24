import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {jobImportTemplate,previewJobImport,scheduleExportRows,csvText,validateJobImportAttempt} from '@/services/schedulingTransfers';
import type {PlannerData} from '@/services/schedulingPlanner';
import type {SchedulingJob} from '@/services/schedulingJobs';

const workspaceId='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const data:PlannerData={
 workers:[{id:'33333333-3333-4333-8333-333333333333',name:'Ricki',active:true,skills:[]}],
 jobs:[{id:'44444444-4444-4444-8444-444444444444',title:'Support shift',startAt:'2026-10-09T08:00:00.000Z',endAt:'2026-10-09T11:00:00.000Z',timezone:'Europe/London',location:'Birmingham',skills:[],skillRequirementMode:'all',count:1,status:'open'}],
 assignments:[{id:'55555555-5555-4555-8555-555555555555',workerId:'33333333-3333-4333-8333-333333333333',jobId:'44444444-4444-4444-8444-444444444444',startAt:'2026-10-09T08:00:00.000Z',endAt:'2026-10-09T11:00:00.000Z',status:'active'}],
 patterns:[],
 leave:[
  {id:'66666666-6666-4666-8666-666666666666',workerId:'33333333-3333-4333-8333-333333333333',startAt:'2026-10-10T08:00:00.000Z',endAt:'2026-10-10T17:00:00.000Z',category:'sickness',status:'active'},
  {id:'77777777-7777-4777-8777-777777777777',workerId:'33333333-3333-4333-8333-333333333333',startAt:'2026-10-11T08:00:00.000Z',endAt:'2026-10-11T17:00:00.000Z',category:'unavailable',status:'active'},
 ],
};
const existing:SchedulingJob={jobId:'88888888-8888-4888-8888-888888888888',workspaceId,title:'Existing',startAt:'2026-10-12T08:00:00.000Z',endAt:'2026-10-12T16:00:00.000Z',timezone:'Europe/London',location:'Office',requiredSkills:[],skillRequirementMode:'all',staffingCount:1,status:'open',version:1};
const migration=readFileSync(new URL('../../supabase/migrations/20261010230000_rev_scheduling_job_import.sql',import.meta.url),'utf8');

describe('Scheduling CSV transfers',()=>{
 it.each([
  ['=2+3', "'=2+3\r\n"],
  ['+2+3', "'+2+3\r\n"],
  ['-2+3', "'-2+3\r\n"],
  ['@SUM(1)', "'@SUM(1)\r\n"],
  ['  =2+3', "'  =2+3\r\n"],
  ['\t=2+3', "'\t=2+3\r\n"],
  ['\r=2+3', '"\'\r=2+3"\r\n'],
  ['\n=2+3', '"\'\n=2+3"\r\n'],
 ])('exports formula-like cell %j as literal text', (value, expected) => {
  expect(csvText([[value]])).toBe(expected);
 });
 it('preserves ordinary CSV text, dates and quote escaping', () => {
  expect(csvText([['Support shift', '2026-10-23', '09:00', '2', 'A, B', 'Say "hello"']]))
   .toBe('Support shift,2026-10-23,09:00,2,"A, B","Say ""hello"""\r\n');
 });
 it('exports authorised schedule columns with local times and non-medical labels',()=>{
  const rows=scheduleExportRows(data,{startDate:'2026-10-05',endDate:'2026-10-11',timezone:'Europe/London'});
  expect(rows[0]).toEqual(['record_type','worker','job','date','local_start','local_end','timezone','recorded_status']);
  expect(rows).toContainEqual(['Assignment','Ricki','Support shift','2026-10-09','09:00','12:00','Europe/London','active']);
  expect(rows.some(row=>row[0]==='Sickness'&&row[1]==='Ricki')).toBe(true);
  expect(rows.some(row=>row[0]==='Unavailable'&&row[1]==='Ricki')).toBe(true);
  expect(csvText(rows)).not.toMatch(/diagnos|medical|payroll|funder/i);
 });

 it('limits assignment exports to the chosen date range',()=>{
  const rows=scheduleExportRows(data,{startDate:'2026-10-10',endDate:'2026-10-11',timezone:'Europe/London',assignmentsOnly:true});
  expect(rows).toHaveLength(1);
 });

 it('parses the exact template using DST-safe local conversion',()=>{
  const preview=previewJobImport(jobImportTemplate().replace('Example support shift','Imported shift'),workspaceId,[],()=>requestId);
  expect(preview.canConfirm).toBe(true);
  expect(preview.rows[0].attempt).toMatchObject({title:'Imported shift',startAt:'2026-10-12T08:00:00.000Z',endAt:'2026-10-12T16:00:00.000Z',timezone:'Europe/London'});
 });

 it('rejects malformed headers, duplicate rows, existing jobs and invalid DST times',()=>{
  expect(()=>previewJobImport('wrong,header\r\nx,y\r\n',workspaceId,[],()=>requestId)).toThrow(/template/);
  const duplicate=[jobImportTemplate().trim(),jobImportTemplate().trim().split('\n')[1]].join('\r\n')+'\r\n';
  expect(previewJobImport(duplicate,workspaceId,[],()=>requestId).canConfirm).toBe(false);
  const existingCsv=jobImportTemplate().replace('Example support shift,2026-10-12,09:00,2026-10-12,17:00,Europe/London,Birmingham office', 'Existing,2026-10-12,09:00,2026-10-12,17:00,Europe/London,Office');
  expect(previewJobImport(existingCsv,workspaceId,[existing],()=>requestId).rows[0].errors.join(' ')).toMatch(/already exists/);
  const dst=jobImportTemplate().replace('2026-10-12,09:00,2026-10-12,17:00','2026-10-25,01:30,2026-10-25,02:30');
  expect(previewJobImport(dst,workspaceId,[],()=>requestId).canConfirm).toBe(false);
 });

 it('requires unique retained row requests bound to one workspace',()=>{
  const row=previewJobImport(jobImportTemplate(),workspaceId,[],()=>requestId).rows[0].attempt!;
  expect(()=>validateJobImportAttempt({workspaceId,batchRequestId:'99999999-9999-4999-8999-999999999999',rows:[row,row]})).toThrow();
 });

 it('keeps bulk saving service-only, atomic and delegated to the existing job write',()=>{
  expect(migration).toContain('public.save_rev_scheduling_job(');
  expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
  expect(migration).toContain('return previous.result');
  expect(migration).toContain('Imported job duplicates existing record');
  expect(migration).toContain('to service_role');
  expect(migration).toContain('from public, anon, authenticated');
  expect(migration).not.toContain('grant insert on public.scheduling_jobs to authenticated');
 });
});

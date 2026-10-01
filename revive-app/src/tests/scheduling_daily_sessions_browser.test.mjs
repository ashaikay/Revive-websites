import test from 'node:test';
import assert from 'node:assert/strict';
import { clearDailySessionAttempt, previewDailySessions, rememberDailySessionAttempt, restoreDailySessionAttempt, submitDailySessionAttempt } from '../services/schedulingDailySessions.ts';
import {formatSchedulingDate} from '../services/schedulingDisplay.ts';
import {loadPlannerData,spansPlannerDay} from '../services/schedulingPlanner.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const otherUserId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const jobIds = ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777'];
const attempt = { workspaceId, requestId, title: 'Cardiff installation', timezone: 'Europe/London', location: 'Cardiff', requiredSkills: ['Safety', 'Installer'], staffingCount: 2, firstDay: '2026-10-15', lastDay: '2026-10-17', workingDays: [6, 4, 5], startLocal: '11:00', endLocal: '16:00' };

function result(times = [
  ['2026-10-15T10:00:00.000Z', '2026-10-15T15:00:00.000Z'],
  ['2026-10-16T10:00:00.000Z', '2026-10-16T15:00:00.000Z'],
  ['2026-10-17T10:00:00.000Z', '2026-10-17T15:00:00.000Z'],
]) {
  return { requestId, workspaceId, scheduleType: 'daily_daytime', jobs: times.map(([startAt, endAt], index) => ({ jobId: jobIds[index], workspaceId, title: attempt.title, startAt, endAt, timezone: attempt.timezone, location: attempt.location, requiredSkills: ['Installer', 'Safety'], staffingCount: 2, status: 'open', version: 1 })) };
}

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('Cardiff range previews three separate selected daytime sessions', () => {
  assert.deepEqual(previewDailySessions(attempt), [
    { date: '2026-10-15', startLocal: '11:00', endLocal: '16:00', startAt: '2026-10-15T10:00:00.000Z', endAt: '2026-10-15T15:00:00.000Z' },
    { date: '2026-10-16', startLocal: '11:00', endLocal: '16:00', startAt: '2026-10-16T10:00:00.000Z', endAt: '2026-10-16T15:00:00.000Z' },
    { date: '2026-10-17', startLocal: '11:00', endLocal: '16:00', startAt: '2026-10-17T10:00:00.000Z', endAt: '2026-10-17T15:00:00.000Z' },
  ]);
});

test('date iteration is capped at 31 days and stops safely at 9999-12-31', () => {
  assert.equal(previewDailySessions({ ...attempt, firstDay: '2026-10-01', lastDay: '2026-10-31', workingDays: [1,2,3,4,5,6,7] }).length, 31);
  assert.deepEqual(previewDailySessions({ ...attempt, timezone: 'UTC', firstDay: '9999-12-31', lastDay: '9999-12-31', workingDays: [5] }), [
    { date: '9999-12-31', startLocal: '11:00', endLocal: '16:00', startAt: '9999-12-31T11:00:00.000Z', endAt: '9999-12-31T16:00:00.000Z' },
  ]);
});

test('unselected dates are excluded and an empty actual selection is rejected', () => {
  assert.deepEqual(previewDailySessions({ ...attempt, workingDays: [4, 5] }).map(item => item.date), ['2026-10-15', '2026-10-16']);
  assert.throws(() => previewDailySessions({ ...attempt, workingDays: [1] }));
});

test('invalid dates, over-31-day ranges and overnight hours are rejected before invoke', async () => {
  let calls = 0;
  for (const patch of [
    { firstDay: '2026-02-30' },
    { lastDay: '2026-10-14' },
    { firstDay: '2026-10-01', lastDay: '2026-11-01' },
    { workingDays: [] },
    { startLocal: '16:00', endLocal: '11:00' },
    { startLocal: '11:00', endLocal: '11:00' },
  ]) await assert.rejects(submitDailySessionAttempt({ ...attempt, ...patch }, async () => { calls += 1; return result(); }));
  assert.equal(calls, 0);
});

test('save sends one canonical request and validates three staffing requirements', async () => {
  let calls = 0;
  const saved = await submitDailySessionAttempt(attempt, async (name, body) => {
    calls += 1;
    assert.equal(name, 'rev-scheduling-daily-sessions-save');
    assert.deepEqual(body.requiredSkills, ['Installer', 'Safety']);
    assert.deepEqual(body.workingDays, [4, 5, 6]);
    return result();
  });
  assert.equal(calls, 1);
  assert.equal(saved.jobs.length, 3);
  assert.ok(saved.jobs.every(job => job.staffingCount === 2));
});

test('saved daily sessions project onto separate planner dates with UK labels',async()=>{
 const saved=await submitDailySessionAttempt(attempt,async()=>result());
 const rows={
  scheduling_workers:[],
  scheduling_jobs:saved.jobs.map(job=>({id:job.jobId,workspace_id:job.workspaceId,title:job.title,start_at:job.startAt,end_at:job.endAt,timezone:job.timezone,location:job.location,required_skills:job.requiredSkills,staffing_count:job.staffingCount,status:job.status,version:job.version})),
  scheduling_assignments:[],scheduling_worker_patterns:[],scheduling_worker_unavailability:[],
 };
 const planner=await loadPlannerData(workspaceId,async table=>rows[table]);
 assert.deepEqual(planner.jobs.map(job=>['2026-10-15','2026-10-16','2026-10-17'].filter(day=>spansPlannerDay(job.startAt,job.endAt,day,'Europe/London'))),[['2026-10-15'],['2026-10-16'],['2026-10-17']]);
 assert.deepEqual(['2026-10-15','2026-10-16','2026-10-17'].map(formatSchedulingDate),['15/10/2026','16/10/2026','17/10/2026']);
});

test('unknown save is not automatically retried and exact request survives refresh', async () => {
  let calls = 0;
  await assert.rejects(submitDailySessionAttempt(attempt, async () => { calls += 1; throw new Error('Unknown'); }));
  assert.equal(calls, 1);
  const saved = storage();
  rememberDailySessionAttempt(saved, userId, attempt);
  assert.deepEqual(restoreDailySessionAttempt(saved, workspaceId, userId), { ...attempt, requiredSkills: ['Installer', 'Safety'], workingDays: [4, 5, 6] });
  assert.equal(restoreDailySessionAttempt(saved, workspaceId, otherUserId), null);
  clearDailySessionAttempt(saved, workspaceId, userId);
  assert.equal(restoreDailySessionAttempt(saved, workspaceId, userId), null);
});

test('DST gaps and repeated local times are rejected before pending storage', () => {
  for (const plan of [
    { ...attempt, firstDay: '2027-03-28', lastDay: '2027-03-28', workingDays: [7], startLocal: '01:30', endLocal: '03:00' },
    { ...attempt, firstDay: '2026-10-25', lastDay: '2026-10-25', workingDays: [7], startLocal: '01:30', endLocal: '03:00' },
  ]) {
    const saved = storage();
    assert.throws(() => rememberDailySessionAttempt(saved, userId, plan), /ambiguous or nonexistent/i);
    assert.equal(restoreDailySessionAttempt(saved, workspaceId, userId), null);
  }
});

test('credential-bearing and mismatched responses cannot confirm a save', async () => {
  for (const patch of [
    { accessToken: 'unsafe' },
    { workspaceId: otherUserId },
    { jobs: result().jobs.slice(0, 2) },
    { jobs: result().jobs.map((job, index) => index ? job : { ...job, staffingCount: 1 }) },
    { jobs: result().jobs.map((job, index) => index ? job : { ...job, startAt: '2026-10-15T10:00:01.000Z' }) },
    { jobs: result().jobs.map((job, index) => index ? job : { ...job, endAt: '2026-10-15T15:00:00.001Z' }) },
  ]) await assert.rejects(submitDailySessionAttempt(attempt, async () => ({ ...result(), ...patch })));
});

test('local clock hours survive the Europe London offset change', async () => {
  const clockAttempt = { ...attempt, firstDay: '2026-10-24', lastDay: '2026-10-26', workingDays: [6, 7, 1] };
  const clockResult = result([
    ['2026-10-24T10:00:00.000Z', '2026-10-24T15:00:00.000Z'],
    ['2026-10-25T11:00:00.000Z', '2026-10-25T16:00:00.000Z'],
    ['2026-10-26T11:00:00.000Z', '2026-10-26T16:00:00.000Z'],
  ]);
  assert.equal((await submitDailySessionAttempt(clockAttempt, async () => clockResult)).jobs.length, 3);
});
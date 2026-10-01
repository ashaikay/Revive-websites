import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSchedulingDailySessionsSave, type DailySessionsDependencies, type DailySessionsInput } from './schedulingDailySessionsBoundary.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const origin = 'http://localhost:5180';
const body = { workspaceId, requestId, title: 'Cardiff installation', timezone: 'Europe/London', location: 'Cardiff', requiredSkills: ['Installer', 'Safety'], staffingCount: 2, firstDay: '2026-10-15', lastDay: '2026-10-17', workingDays: [4, 5, 6], startLocal: '11:00', endLocal: '16:00' };
const ids = ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const graphTimes = [
  ['2026-10-15T10:00:00+00:00', '2026-10-15T15:00:00+00:00'],
  ['2026-10-16T10:00:00+00:00', '2026-10-16T15:00:00+00:00'],
  ['2026-10-17T10:00:00+00:00', '2026-10-17T15:00:00+00:00'],
];

function request(value: unknown = body, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://example.test', { method, headers: { Origin: origin, Authorization: 'Bearer verified', 'Content-Type': 'application/json', ...headers }, body: ['OPTIONS', 'GET'].includes(method) ? undefined : JSON.stringify(value) });
}

function fixture(times = graphTimes) {
  const calls: DailySessionsInput[] = [];
  let authenticationCalls = 0;
  let roleCalls = 0;
  const dependencies: DailySessionsDependencies = {
    allowedOrigin: origin,
    getUserId: async () => { authenticationCalls += 1; return actorId; },
    canManage: async () => { roleCalls += 1; return true; },
    save: async input => {
      calls.push(input);
      return { request_id: input.target_request_id, workspace_id: input.target_workspace_id, schedule_type: 'daily_daytime', jobs: times.map(([start_at, end_at], index) => ({ job_id: ids[index] ?? `${String(index + 10).padStart(8, '0')}-4444-4444-8444-444444444444`, workspace_id: workspaceId, title: input.target_title, start_at, end_at, timezone: input.target_timezone, location: input.target_location, required_skills: input.target_required_skills, staffing_count: input.target_staffing_count, status: 'open', version: 1 })) };
    },
  };
  return { dependencies, calls, counts: () => ({ authenticationCalls, roleCalls }) };
}

test('verified manager creates three sanitized Cardiff daytime sessions', async () => {
  const context = fixture();
  const response = await handleSchedulingDailySessionsSave(request(), context.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].initiating_user_id, actorId);
  assert.deepEqual(context.calls[0].target_working_days, [4, 5, 6]);
  assert.deepEqual(context.calls[0].target_required_skills, ['Installer', 'Safety']);
  const result = await response.json();
  assert.equal(result.jobs.length, 3);
  assert.ok(result.jobs.every((job: Record<string, unknown>) => job.staffingCount === 2 && !('private_token' in job)));
});

test('permissions and session are checked before the single service write', async () => {
  for (const patch of [{ getUserId: async () => null }, { canManage: async () => false }]) {
    const context = fixture();
    const response = await handleSchedulingDailySessionsSave(request(), { ...context.dependencies, ...patch });
    assert.ok(response.status >= 400);
    assert.equal(context.calls.length, 0);
  }
});

test('invalid ranges, empty selections and overnight hours stop before auth', async () => {
  for (const patch of [
    { firstDay: '2026-10-18', lastDay: '2026-10-17' },
    { firstDay: '2026-10-01', lastDay: '2026-11-01' },
    { workingDays: [] },
    { workingDays: [1] },
    { startLocal: '16:00', endLocal: '11:00' },
    { startLocal: '11:00', endLocal: '11:00' },
    { actorUserId: actorId },
  ]) {
    const context = fixture();
    const response = await handleSchedulingDailySessionsSave(request({ ...body, ...patch }), context.dependencies);
    assert.equal(response.status, 400);
    assert.deepEqual(context.counts(), { authenticationCalls: 0, roleCalls: 0 });
    assert.equal(context.calls.length, 0);
  }
});

test('selected weekdays determine exact response count', async () => {
  const context = fixture([graphTimes[0], graphTimes[1]]);
  const response = await handleSchedulingDailySessionsSave(request({ ...body, workingDays: [4, 5] }), context.dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).jobs.length, 2);
});

test('date iteration is capped at 31 days and stops safely at 9999-12-31', async () => {
  const maximum = fixture(Array.from({ length: 31 }, (_, index) => {
    const day = String(index + 1).padStart(2, '0');
    return [`2026-10-${day}T11:00:00+00:00`, `2026-10-${day}T16:00:00+00:00`];
  }));
  assert.equal((await handleSchedulingDailySessionsSave(request({ ...body, timezone: 'UTC', firstDay: '2026-10-01', lastDay: '2026-10-31', workingDays: [1,2,3,4,5,6,7] }), maximum.dependencies)).status, 200);
  const terminal = fixture([['9999-12-31T11:00:00+00:00', '9999-12-31T16:00:00+00:00']]);
  const response = await handleSchedulingDailySessionsSave(request({ ...body, timezone: 'UTC', firstDay: '9999-12-31', lastDay: '9999-12-31', workingDays: [5] }), terminal.dependencies);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).jobs.length, 1);
});

test('DST gaps and repeated local times stop before authentication and save', async () => {
  for (const patch of [
    { firstDay: '2027-03-28', lastDay: '2027-03-28', workingDays: [7], startLocal: '01:30', endLocal: '03:00' },
    { firstDay: '2026-10-25', lastDay: '2026-10-25', workingDays: [7], startLocal: '01:30', endLocal: '03:00' },
  ]) {
    const context = fixture([]);
    const response = await handleSchedulingDailySessionsSave(request({ ...body, ...patch }), context.dependencies);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ambiguous or nonexistent/i);
    assert.deepEqual(context.counts(), { authenticationCalls: 0, roleCalls: 0 });
    assert.equal(context.calls.length, 0);
  }
});

test('local hours remain stable when UTC offset changes', async () => {
  const context = fixture([
    ['2026-10-24T10:00:00+00:00', '2026-10-24T15:00:00+00:00'],
    ['2026-10-25T11:00:00+00:00', '2026-10-25T16:00:00+00:00'],
    ['2026-10-26T11:00:00+00:00', '2026-10-26T16:00:00+00:00'],
  ]);
  const response = await handleSchedulingDailySessionsSave(request({ ...body, firstDay: '2026-10-24', lastDay: '2026-10-26', workingDays: [6, 7, 1] }), context.dependencies);
  assert.equal(response.status, 200);
});

test('mismatched, credential-bearing and malformed results deny confirmation without retry', async () => {
  for (const mutate of [
    (value: Record<string, unknown>) => ({ ...value, access_token: 'unsafe' }),
    (value: Record<string, unknown>) => ({ ...value, workspace_id: actorId }),
    (value: Record<string, unknown>) => ({ ...value, jobs: (value.jobs as object[]).slice(0, 2) }),
    (value: Record<string, unknown>) => ({ ...value, jobs: (value.jobs as Record<string, unknown>[]).map((job, index) => index ? job : { ...job, staffing_count: 1 }) }),
    (value: Record<string, unknown>) => ({ ...value, jobs: (value.jobs as Record<string, unknown>[]).map((job, index) => index ? job : { ...job, start_at: '2026-10-15T10:00:01+00:00' }) }),
    (value: Record<string, unknown>) => ({ ...value, jobs: (value.jobs as Record<string, unknown>[]).map((job, index) => index ? job : { ...job, end_at: '2026-10-15T15:00:00.001+00:00' }) }),
  ]) {
    const context = fixture();
    const save = context.dependencies.save;
    context.dependencies.save = async input => mutate(await save(input) as Record<string, unknown>);
    const response = await handleSchedulingDailySessionsSave(request(), context.dependencies);
    assert.equal(response.status, 403);
    assert.equal(context.calls.length, 1);
  }
});

test('origin, method, bearer and content type refuse service writes', async () => {
  for (const candidate of [request(body, { Origin: 'https://foreign.test' }), request(body, {}, 'GET'), request(body, { Authorization: '' }), request(body, { 'Content-Type': 'text/plain' })]) {
    const context = fixture();
    assert.ok((await handleSchedulingDailySessionsSave(candidate, context.dependencies)).status >= 400);
    assert.equal(context.calls.length, 0);
  }
});

test('preflight permits Supabase headers without authentication or save', async () => {
  const context = fixture();
  const response = await handleSchedulingDailySessionsSave(request(undefined, {}, 'OPTIONS'), context.dependencies);
  assert.equal(response.status, 204);
  assert.ok(response.headers.get('Access-Control-Allow-Headers')?.includes('x-client-info'));
  assert.deepEqual(context.counts(), { authenticationCalls: 0, roleCalls: 0 });
  assert.equal(context.calls.length, 0);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {formatSchedulingDate,formatSchedulingInstant,formatSchedulingLocal,formatSchedulingTime} from '../services/schedulingDisplay.ts';

test('ISO dates display in unambiguous UK format without changing the source value',()=>{const source='2026-10-08';assert.equal(formatSchedulingDate(source),'08/10/2026');assert.equal(source,'2026-10-08');});
test('UTC instants display DD/MM/YYYY and HH:mm in the selected timezone',()=>{assert.equal(formatSchedulingInstant('2026-10-08T09:00:00.000Z','Europe/London'),'08/10/2026 10:00');assert.equal(formatSchedulingTime('2026-12-08T09:05:00.000Z','Europe/London'),'09:05');});
test('local control values display in UK format while retaining exclusive interval semantics',()=>{assert.equal(formatSchedulingLocal('2026-10-08T10:00'),'08/10/2026 10:00');assert.equal(formatSchedulingLocal('2026-10-09T00:00'),'09/10/2026 00:00');});
test('invalid dates and local values fail closed',()=>{for(const value of ['2026-02-30','08/10/2026',''])assert.throws(()=>formatSchedulingDate(value));for(const value of ['2026-10-08 10:00','2026-10-08T25:00'])assert.throws(()=>formatSchedulingLocal(value));});
test('planner, jobs, pattern summaries, leave rows and daily previews use UK presentation helpers',()=>{
 const files=['SchedulingWeeklyPlanner.tsx','SchedulingJobsPanel.tsx','WorkerWorkingPatternPanel.tsx','WorkerUnavailabilityPanel.tsx'].map(file=>readFileSync(new URL(`../components/${file}`,import.meta.url),'utf8'));
 for(const source of files)assert.ok(source.includes("@/services/schedulingDisplay"));
 assert.ok(files[0].includes('formatSchedulingDate(day)'));
 assert.ok(files[1].includes('formatSchedulingDate(session.date)'));
 assert.ok(files[2].includes('Saved pattern:'));
 assert.ok(files[3].includes('formatSchedulingLocal(utcLeaveToLocal'));
 assert.ok(files[1].includes('Start date')&&files[1].includes('End date (inclusive)')&&files[1].includes('Start time')&&files[1].includes('End time'));
 assert.ok(!files[2].includes('Leave and shift allocation will follow'));
});
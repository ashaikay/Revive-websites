import test from 'node:test';
import assert from 'node:assert/strict';
import {handleWorkerSave} from './workerSaveBoundary.ts';
import {handleWorkerPatternSave} from '../rev-worker-pattern-save/workerPatternSaveBoundary.ts';
import {handleWorkerUnavailabilitySave} from '../rev-worker-unavailability-save/workerUnavailabilityBoundary.ts';
import {handleSchedulingJobSave} from '../rev-scheduling-job-save/schedulingJobBoundary.ts';
import {handleSchedulingAssignmentSave} from '../rev-scheduling-assignment-save/schedulingAssignmentBoundary.ts';
import {handleSchedulingDailySessionsSave} from '../rev-scheduling-daily-sessions-save/schedulingDailySessionsBoundary.ts';
const unavailable=async()=>{throw Error('Must not be invoked during preflight or a denied request');};
const deps={allowedOrigin:'http://localhost:5180,https://rev11.netlify.app',getUserId:unavailable,canManage:unavailable,save:unavailable,getWorkspaceTimezone:unavailable};
for(const handler of [handleWorkerSave,handleWorkerPatternSave,handleWorkerUnavailabilitySave,handleSchedulingJobSave,handleSchedulingAssignmentSave,handleSchedulingDailySessionsSave]) {
 test(handler.name+' permits only configured exact origins before authentication',async()=>{
  for(const origin of ['https://rev11.netlify.app','http://localhost:5180']) {
   const response=await handler(new Request('http://local',{method:'OPTIONS',headers:{Origin:origin}}),deps);
   assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
   const unauthenticated=await handler(new Request('http://local',{method:'POST',headers:{Origin:origin}}),deps);assert.equal(unauthenticated.status,401);
  }
  for(const origin of ['https://rev11.netlify.app.evil.test','https://unlisted.netlify.app','null']) {
   const response=await handler(new Request('http://local',{method:'OPTIONS',headers:{Origin:origin}}),deps);assert.equal(response.status,403);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  }
 });
}

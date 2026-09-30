import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelectedCalendarAvailability, type SelectedCalendarCredential, type SelectedAvailabilityDependencies } from './selectedCalendarAvailabilityWorkflow.ts';
const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555'];
const query = {workspaceId:ids[0],userId:ids[1],searchStartAt:'2040-09-30T09:00:00.000Z',searchEndAt:'2040-09-30T17:00:00.000Z',timezone:'Europe/London'};
const row:SelectedCalendarCredential={calendar_id:ids[2],connection_id:ids[3],credential_reference:ids[4],provider_calendar_reference:'AAMk+/=',provider_account_reference:'fake@example.test',timezone:'Europe/London',revision:1,refresh_token:'fake-refresh'};
const busy=[{startAt:'2040-09-30T10:00:00.000Z',endAt:'2040-09-30T10:30:00.000Z'}];
function fixture(){
 const calls:string[]=[];let revision=1;
 const deps:SelectedAvailabilityDependencies={
  load:async(w,u)=>{assert.equal(w,query.workspaceId);assert.equal(u,query.userId);calls.push('load');return{...row,revision};},
  refresh:async token=>{calls.push('refresh');assert.equal(token,'fake-refresh');return{accessToken:'fake-access',refreshToken:'fake-rotated'};},
  rotate:async(w,u,s,token)=>{calls.push('rotate');assert.equal(w,query.workspaceId);assert.equal(u,query.userId);assert.equal(s.revision,1);assert.equal(token,'fake-rotated');revision=2;return{credential_reference:row.credential_reference,revision};},
  read:async request=>{calls.push('read');assert.equal(request.accessToken,'fake-access');assert.equal(request.selectedCalendar.providerCalendarReference,'AAMk+/=');assert.equal(request.selectedCalendarId,row.calendar_id);return busy;}
 };return{calls,deps};
}
test('durable rotation precedes exact selected read and both rechecks; output contains intervals only',async()=>{
 const f=fixture();assert.deepEqual(await runSelectedCalendarAvailability(query,f.deps),busy);assert.deepEqual(f.calls,['load','refresh','rotate','load','read','load']);
});
test('invalid identifiers, range and timezone stop before credential reads',async()=>{
 for(const patch of [{workspaceId:'bad'},{userId:'bad'},{timezone:'bad-zone'},{searchEndAt:'2040-10-20T17:00:00.000Z'}]){const f=fixture();await assert.rejects(runSelectedCalendarAvailability({...query,...patch},f.deps));assert.deepEqual(f.calls,[]);}
});
test('malformed or mismatched selected rows stop before refresh',async()=>{
 for(const patch of [{timezone:'UTC'},{revision:0},{credential_reference:'bad'},{refresh_token:''}]){const f=fixture();f.deps.load=async()=>({...row,...patch});await assert.rejects(runSelectedCalendarAvailability(query,f.deps));assert.deepEqual(f.calls,[]);}
});
test('load, refresh, rotation and provider refusal stop later stages without retries',async()=>{
 for(const stage of ['load','refresh','rotate','read'] as const){const f=fixture();f.deps[stage]=async()=>{f.calls.push(stage);throw new Error('fake refusal');};await assert.rejects(runSelectedCalendarAvailability(query,f.deps));assert.equal(f.calls.filter(c=>c===stage).length,1);assert.equal(f.calls.at(-1),stage);}
});
test('stale rotation response cannot reach Graph',async()=>{
 const f=fixture();f.deps.rotate=async()=>({credential_reference:row.credential_reference,revision:1});await assert.rejects(runSelectedCalendarAvailability(query,f.deps));assert.ok(!f.calls.includes('read'));
});
test('selection drift or revoked credentials before read stop Graph; drift after read withholds result',async()=>{
 for(const at of [2,3]){const f=fixture();let loads=0;const original=f.deps.load;f.deps.load=async(w,u)=>{const snapshot=await original(w,u);return ++loads===at?{...snapshot,calendar_id:ids[0]}:snapshot;};await assert.rejects(runSelectedCalendarAvailability(query,f.deps));assert.equal(f.calls.includes('read'),at===3);}
 const f=fixture();let loads=0;const original=f.deps.load;f.deps.load=async(w,u)=>{if(++loads===2)throw new Error('revoked');return original(w,u);};await assert.rejects(runSelectedCalendarAvailability(query,f.deps));assert.ok(!f.calls.includes('read'));
});
test('malformed intervals are refused and unexpected event fields are stripped',async()=>{
 const f=fixture();f.deps.read=async()=>[{...busy[0],title:'private'}];assert.deepEqual(await runSelectedCalendarAvailability(query,f.deps),busy);
 const bad=fixture();bad.deps.read=async()=>[{startAt:'bad',endAt:busy[0].endAt}];await assert.rejects(runSelectedCalendarAvailability(query,bad.deps));
});

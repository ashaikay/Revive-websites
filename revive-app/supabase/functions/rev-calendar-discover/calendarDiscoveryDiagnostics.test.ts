import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCalendarDiscovery } from './calendarDiscoveryBoundary.ts';
import { CalendarDiscoveryFailure, runCalendarDiscovery, type DiscoveryWorkflowDependencies } from './calendarDiscoveryWorkflow.ts';

const connectionId='4d2b4b34-9f79-496b-82b0-663e71cd3b5a';
const workspaceId='fdce6c53-d1cb-48bc-b35a-7f57674d80f6';
const userId='baf67b40-2fdf-4496-9c1d-1ac1aa5e9892';
const origin='http://127.0.0.1:5180';
const metadata={providerAccountReference:'owner@example.test',calendars:[{providerCalendarReference:'default',displayName:'Calendar',ownerAddress:'owner@example.test',isDefault:true}]};

function workflow(overrides:Partial<DiscoveryWorkflowDependencies>={}):DiscoveryWorkflowDependencies{
 return{
  load:async()=>({refresh_token:'fake-refresh',credential_reference:userId,revision:1}),
  refresh:async()=>({accessToken:'fake-access',refreshToken:'fake-next-refresh'}),
  rotate:async()=>({credential_reference:userId,revision:2}),
  discover:async()=>metadata,
  save:async()=>({connection_id:connectionId,connection_status:'connected',calendar_count:1}),
  ...overrides,
 };
}
function request():Request{
 return new Request('https://example.test/discover',{method:'POST',headers:{Origin:origin,Authorization:'Bearer fake', 'Content-Type':'application/json'},body:JSON.stringify({workspaceId,connectionId,timezone:'Europe/London'})});
}

test('each workflow failure is reduced to its fixed stage and allowlisted code',async()=>{
 const cases=[
  ['load','credential_load','credential_load_failed'],
  ['refresh','token_refresh','token_refresh_failed'],
  ['rotate','credential_rotation','credential_rotation_failed'],
  ['discover','calendar_discovery','calendar_discovery_failed'],
  ['save','database_save','database_save_failed'],
 ] as const;
 for(const [operation,stage,code] of cases){
  const deps=workflow({[operation]:async()=>{throw new Error('secret token mailbox@example.test calendar contents authorization URL');}});
  await assert.rejects(runCalendarDiscovery(connectionId,deps),(error:unknown)=>{
   assert.ok(error instanceof CalendarDiscoveryFailure);
   assert.equal(error.stage,stage);assert.equal(error.code,code);assert.equal(error.message,code);
   assert.doesNotMatch(error.message,/fake-refresh|fake-access|@example\.test|calendar contents|authorization URL/i);
   return true;
  });
 }
});

test('configuration failure diagnostic contains no configuration details and public response stays unchanged',async()=>{
 const diagnostics:Array<[string,string]>=[];
 const response=await handleCalendarDiscovery(request(),{
  allowedOrigin:origin,
  getUserId:async()=>userId,
  canManage:async()=>true,
  discover:async()=>{throw new CalendarDiscoveryFailure('configuration','configuration_unavailable');},
  reportFailure:(stage,code)=>diagnostics.push([stage,code]),
 });
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'Calendar connection unavailable.'});
 assert.deepEqual(diagnostics,[['configuration','configuration_unavailable']]);
 assert.doesNotMatch(JSON.stringify(diagnostics),/secret|token|@example\.test|authorization URL/i);
});

test('manager refusal is logged as a fixed diagnostic without running discovery',async()=>{
 const diagnostics:Array<[string,string]>=[];
 const response=await handleCalendarDiscovery(request(),{
  allowedOrigin:origin,
  getUserId:async()=>userId,
  canManage:async()=>false,
  discover:async()=>{assert.fail('Discovery must not run');return{connectionId,connectionStatus:'connected',calendarCount:1};},
  reportFailure:(stage,code)=>diagnostics.push([stage,code]),
 });
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'Calendar connection unavailable.'});
 assert.deepEqual(diagnostics,[['manager_check','manager_denied']]);
});
test('manager-check errors use a fixed code and do not leak the thrown error',async()=>{
 const diagnostics:Array<[string,string]>=[];
 const response=await handleCalendarDiscovery(request(),{
  allowedOrigin:origin,
  getUserId:async()=>userId,
  canManage:async()=>{throw new Error('private role query details and mailbox@example.test');},
  discover:async()=>{assert.fail('Discovery must not run');return{connectionId,connectionStatus:'connected',calendarCount:1};},
  reportFailure:(stage,code)=>diagnostics.push([stage,code]),
 });
 assert.equal(response.status,403);
 assert.deepEqual(await response.json(),{error:'Calendar connection unavailable.'});
 assert.deepEqual(diagnostics,[['manager_check','manager_check_failed']]);
 assert.doesNotMatch(JSON.stringify(diagnostics),/private|@example\.test/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {handleBusinessHoursSave,type BusinessHoursDependencies} from './calendarBusinessHoursBoundary.ts';
const workspaceId='11111111-1111-4111-8111-111111111111',actor='33333333-3333-4333-8333-333333333333',origin='http://localhost:5180';
const body={workspaceId,timezone:'Europe/London',workingDays:[5,1,3],startLocal:'09:00',endLocal:'17:00',expectedVersion:0};
const req=(value:unknown=body,headers:Record<string,string>={},method='POST')=>new Request('https://example.test',{method,headers:{Origin:origin,Authorization:'Bearer fake','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(value)}:{})});
function fixture(){const calls:unknown[]=[];const deps:BusinessHoursDependencies={allowedOrigin:origin,getUserId:async()=>actor,canManage:async()=>true,save:async(input)=>{calls.push(input);return{workspace_id:input.target_workspace_id,timezone:input.target_timezone,working_days:input.target_working_days,business_start_local:input.target_start_local,business_end_local:input.target_end_local,version:input.expected_version+1,private_detail:'must not escape'};}};return{calls,deps};}
test('verified manager saves canonical policy and receives sanitized no-store metadata',async()=>{
 const f=fixture();const r=await handleBusinessHoursSave(req(),f.deps);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls,[{target_workspace_id:workspaceId,initiating_user_id:actor,target_timezone:'Europe/London',target_working_days:[1,3,5],target_start_local:'09:00',target_end_local:'17:00',expected_version:0}]);assert.deepEqual(await r.json(),{workspaceId,timezone:'Europe/London',workingDays:[1,3,5],startLocal:'09:00',endLocal:'17:00',version:1});
});
test('invalid policy, injected actor and unsafe versions stop before service writes',async()=>{
 for(const change of [{userId:actor},{workspaceId:123},{timezone:'Wrong/Zone'},{workingDays:[]},{workingDays:[1,1]},{workingDays:[8]},{workingDays:[null]},{startLocal:'9:00'},{endLocal:'24:00'},{endLocal:'09:00'},{expectedVersion:-1},{expectedVersion:1.5},{expectedVersion:Number.MAX_SAFE_INTEGER}]){const f=fixture();assert.equal((await handleBusinessHoursSave(req({...body,...change}),f.deps)).status,400);assert.deepEqual(f.calls,[]);}
});
test('origin, method, bearer and content type refuse writes',async()=>{
 for(const r of [req(body,{Origin:'https://wrong.test'}),req(body,{},'GET'),req(body,{Authorization:''}),req(body,{'Content-Type':'text/plain'})]){const f=fixture();assert.ok((await handleBusinessHoursSave(r,f.deps)).status>=400);assert.deepEqual(f.calls,[]);}
});
test('invalid session and denied management role stop before service writes',async()=>{
 for(const mode of ['auth','role']){const f=fixture();if(mode==='auth')f.deps.getUserId=async()=>null;else f.deps.canManage=async()=>false;assert.ok((await handleBusinessHoursSave(req(),f.deps)).status>=400);assert.deepEqual(f.calls,[]);}
});
test('preflight permits Supabase headers without authentication or writes',async()=>{
 const f=fixture();f.deps.getUserId=async()=>{throw new Error('unreachable');};const r=await handleBusinessHoursSave(req(body,{},'OPTIONS'),f.deps);assert.equal(r.status,204);assert.match(r.headers.get('Access-Control-Allow-Headers')??'',/x-client-info/);assert.deepEqual(f.calls,[]);
});
test('stale/refused or mismatched saved result fails closed once without private details',async()=>{
 for(const mode of ['refused','workspace','version','days','time']){const f=fixture();const original=f.deps.save;let count=0;f.deps.save=async(input)=>{count++;if(mode==='refused')throw new Error('private database details');const row=await original(input) as Record<string,unknown>;if(mode==='workspace')row.workspace_id=actor;if(mode==='version')row.version=2;if(mode==='days')row.working_days=[2];if(mode==='time')row.business_end_local='18:00';return row;};const r=await handleBusinessHoursSave(req(),f.deps);assert.equal(r.status,403);assert.equal(count,1);assert.deepEqual(await r.json(),{error:'Business hours could not be saved.'});}
});
test('existing policy revision is forwarded and advances exactly once',async()=>{
 const f=fixture();const r=await handleBusinessHoursSave(req({...body,expectedVersion:7}),f.deps);assert.equal(r.status,200);assert.equal((await r.json()).version,8);assert.equal(f.calls.length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCalendarReconnect,type CalendarReconnectDependencies} from './calendarReconnectBoundary.ts';
const workspaceId='11111111-1111-4111-8111-111111111111',connectionId='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',origin='http://localhost:5180';
const req=(body:unknown={workspaceId,connectionId},headers:Record<string,string>={},method='POST')=>new Request('https://example.test',{method,headers:{Origin:origin,Authorization:'Bearer fake','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
function fixture(allowedOrigin=origin){const calls:unknown[]=[],authorityCalls:string[]=[];const deps:CalendarReconnectDependencies={allowedOrigin,getUserId:async()=>{authorityCalls.push('auth');return actor;},canManage:async()=>{authorityCalls.push('membership');return true;},prepare:async(input)=>{calls.push(input);return{connection_id:connectionId,connection_status:'disconnected'};}};return{calls,authorityCalls,deps};}
test('verified owner/admin sends only scoped identifiers and returns sanitized no-store disconnected result',async()=>{
 const f=fixture();const response=await handleCalendarReconnect(req(),f.deps);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls,[{target_workspace_id:workspaceId,target_connection_id:connectionId,initiating_user_id:actor}]);assert.deepEqual(await response.json(),{connectionId,connectionStatus:'disconnected'});
});
test('origin, method, bearer, content type and injected actor deny before reconnect',async()=>{
 for(const request of [req(undefined,{Origin:'https://wrong.test'}),req(undefined,{},'GET'),req(undefined,{Authorization:''}),req(undefined,{'Content-Type':'text/plain'}),req({workspaceId,connectionId,userId:actor}),req({workspaceId,connectionId:'bad'})]){const f=fixture();assert.ok((await handleCalendarReconnect(request,f.deps)).status>=400);assert.deepEqual(f.calls,[]);}
});
test('invalid session and inactive/member role deny before service operation',async()=>{
 for(const mode of ['auth','role']){const f=fixture();if(mode==='auth')f.deps.getUserId=async()=>null;else f.deps.canManage=async()=>false;assert.ok((await handleCalendarReconnect(req(),f.deps)).status>=400);assert.deepEqual(f.calls,[]);}
});
test('preflight includes Supabase client header and never reconnects',async()=>{
 const f=fixture();const response=await handleCalendarReconnect(req(undefined,{},'OPTIONS'),f.deps);assert.equal(response.status,204);assert.match(response.headers.get('Access-Control-Allow-Headers')??'',/x-client-info/);assert.deepEqual(f.calls,[]);
});
test('local preflights allow both configured development origins and never call authority',async()=>{
 for(const acceptedOrigin of ['http://localhost:5180','http://127.0.0.1:5180']){
  const f=fixture('http://localhost:5180');
  const response=await handleCalendarReconnect(req(undefined,{Origin:acceptedOrigin},'OPTIONS'),f.deps);
  assert.equal(response.status,204);assert.equal(response.headers.get('Access-Control-Allow-Origin'),acceptedOrigin);assert.equal(response.headers.get('Vary'),'Origin');
  assert.deepEqual(f.authorityCalls,[]);assert.deepEqual(f.calls,[]);
 }
});
test('missing and unrelated origins are rejected before auth or database authority',async()=>{
 const missing=req(undefined,{},'OPTIONS');missing.headers.delete('Origin');
 for(const request of [missing,req(undefined,{Origin:'https://unrelated.test'},'OPTIONS')]){
  const f=fixture();const response=await handleCalendarReconnect(request,f.deps);
  assert.equal(response.status,403);assert.deepEqual(f.authorityCalls,[]);assert.deepEqual(f.calls,[]);
 }
});
test('production origin remains restricted to its exact configured origin',async()=>{
 const f=fixture('https://app.example.test');
 const allowed=await handleCalendarReconnect(req(undefined,{Origin:'https://app.example.test'},'OPTIONS'),f.deps);
 assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'https://app.example.test');assert.equal(allowed.headers.get('Vary'),'Origin');
 for(const requestOrigin of ['http://localhost:5180','http://127.0.0.1:5180','https://unrelated.test']){
  const rejected=await handleCalendarReconnect(req(undefined,{Origin:requestOrigin},'OPTIONS'),f.deps);assert.equal(rejected.status,403);
 }
 assert.deepEqual(f.authorityCalls,[]);assert.deepEqual(f.calls,[]);
});
test('RPC refusal and mismatched result fail closed with no private error or automatic retry',async()=>{
 for(const mode of ['refused','wrong-id','wrong-status']){const f=fixture();let count=0;f.deps.prepare=async()=>{count++;if(mode==='refused')throw new Error('private token detail');return{connection_id:mode==='wrong-id'?actor:connectionId,connection_status:mode==='wrong-status'?'connected':'disconnected'};};const response=await handleCalendarReconnect(req(),f.deps);assert.equal(response.status,403);assert.equal(count,1);assert.deepEqual(await response.json(),{error:'Calendar connection unavailable.'});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCalendarReconnect,type CalendarReconnectDependencies} from './calendarReconnectBoundary.ts';
const workspaceId='11111111-1111-4111-8111-111111111111',connectionId='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',origin='http://localhost:5180';
const req=(body:unknown={workspaceId,connectionId},headers:Record<string,string>={},method='POST')=>new Request('https://example.test',{method,headers:{Origin:origin,Authorization:'Bearer fake','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
function fixture(){const calls:unknown[]=[];const deps:CalendarReconnectDependencies={allowedOrigin:origin,getUserId:async()=>actor,canManage:async()=>true,prepare:async(input)=>{calls.push(input);return{connection_id:connectionId,connection_status:'disconnected'};}};return{calls,deps};}
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
test('RPC refusal and mismatched result fail closed with no private error or automatic retry',async()=>{
 for(const mode of ['refused','wrong-id','wrong-status']){const f=fixture();let count=0;f.deps.prepare=async()=>{count++;if(mode==='refused')throw new Error('private token detail');return{connection_id:mode==='wrong-id'?actor:connectionId,connection_status:mode==='wrong-status'?'connected':'disconnected'};};const response=await handleCalendarReconnect(req(),f.deps);assert.equal(response.status,403);assert.equal(count,1);assert.deepEqual(await response.json(),{error:'Calendar connection unavailable.'});}
});

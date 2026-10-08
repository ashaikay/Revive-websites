import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCalendarOAuthCompletion, exchangeCalendarOAuthCode, type CalendarOAuthCompletionDependencies } from './calendarOAuthCompletion.ts';
const workspaceId='fdce6c53-d1cb-48bc-b35a-7f57674d80f6',connectionId='4d2b4b34-9f79-496b-82b0-663e71cd3b5a',userId='baf67b40-2fdf-4496-9c1d-1ac1aa5e9892';
const origin='http://127.0.0.1:5180',state='s'.repeat(43),verifier='v'.repeat(43);
const body={workspaceId,connectionId,state,code:'fake-code'};
function request(input:unknown=body,headers:Record<string,string>={},method='POST'){return new Request('https://example.test/complete',{method,headers:{Origin:origin,Authorization:'Bearer fake-session','Content-Type':'application/json',...headers},...(method==='OPTIONS'?{}:{body:JSON.stringify(input)})});}
function fixture(overrides:Partial<CalendarOAuthCompletionDependencies>={}){
 const calls:string[]=[];
 const deps:CalendarOAuthCompletionDependencies={allowedOrigin:origin,getUserId:async()=>userId,canManage:async()=>true,validateConfiguration:()=>{},consume:async(input)=>{calls.push('consume');assert.deepEqual(input,{target_workspace_id:workspaceId,target_connection_id:connectionId,initiating_user_id:userId,raw_state:state});return{verifier,accessMode:'read',expectedRevision:0};},exchange:async(code,pkce,mode)=>{calls.push('exchange');assert.equal(code,'fake-code');assert.equal(pkce,verifier);assert.equal(mode,'read');return{refreshToken:'fake-refresh',grantedCalendarScopes:['https://graph.microsoft.com/calendars.read']};},store:async(input)=>{calls.push('store');assert.equal(input.initiating_user_id,userId);assert.equal(input.expected_revision,0);assert.equal(input.requested_access_mode,'read');assert.deepEqual(input.granted_calendar_scopes,['https://graph.microsoft.com/calendars.read']);assert.equal(input.refresh_token,'fake-refresh');return {credential_reference:connectionId,revision:1,connection_status:'disconnected'};},...overrides};return{deps,calls};
}
test('authenticated completion consumes before exchange and stores without exposing tokens or activating calendar',async()=>{
 const f=fixture();const r=await handleCalendarOAuthCompletion(request(),f.deps);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls,['consume','exchange','store']);assert.deepEqual(await r.json(),{status:'authorization_saved',connectionId,connectionStatus:'disconnected'});
});
test('preflight and invalid caller input cannot consume state',async()=>{
 for(const [req,status] of [[request(body,{Origin:'https://evil.test'}),403],[request(body,{Authorization:''}),401],[request({...body,refresh_token:'injected'}),400],[request({...body,state:'bad'}),400],[request(body,{'Content-Type':'text/plain'}),415]] as const){const f=fixture();assert.equal((await handleCalendarOAuthCompletion(req,f.deps)).status,status);assert.deepEqual(f.calls,[]);}
 const f=fixture();assert.equal((await handleCalendarOAuthCompletion(request(undefined,{},'OPTIONS'),f.deps)).status,204);assert.deepEqual(f.calls,[]);
});
test('invalid session, inactive/member caller and unavailable configuration stop before state consumption',async()=>{
 for(const overrides of [{getUserId:async()=>null},{canManage:async()=>false},{validateConfiguration:()=>{throw new Error('missing config');}}]){const f=fixture(overrides);assert.ok((await handleCalendarOAuthCompletion(request(),f.deps)).status>=400);assert.deepEqual(f.calls,[]);}
});
test('replayed or cross-tenant state refuses exchange',async()=>{
 const f=fixture({consume:async()=>{throw new Error('private state error');}});const r=await handleCalendarOAuthCompletion(request(),f.deps);assert.equal(r.status,403);assert.deepEqual(f.calls,[]);assert.ok(!(await r.text()).includes('private'));
});
test('exchange and storage failures produce no success and no automatic retry',async()=>{
 for(const stage of ['exchange','store']){let attempts=0;const f=fixture({[stage]:async()=>{attempts++;throw new Error('private token');}});const r=await handleCalendarOAuthCompletion(request(),f.deps);assert.equal(r.status,403);assert.equal(attempts,1);assert.ok(!(await r.text()).includes('private'));if(stage==='exchange')assert.deepEqual(f.calls,['consume']);}
});
const config={clientId:userId,clientSecret:'fake-client-secret',authority:'organizations',redirectUri:'http://127.0.0.1:5180/calendar/callback'};
const token={token_type:'Bearer',access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600,scope:'Calendars.Read'};
test('intercepted token request uses authorization code, server secret and PKCE exactly once',async()=>{
 let calls=0;const fakeFetch:typeof fetch=async(url,init)=>{calls++;assert.equal(url,'https://login.microsoftonline.com/organizations/oauth2/v2.0/token');assert.equal(init?.redirect,'error');assert.equal(init?.method,'POST');const p=new URLSearchParams(String(init?.body));assert.equal(p.get('code_verifier'),verifier);assert.equal(p.get('client_secret'),'fake-client-secret');assert.equal(p.get('grant_type'),'authorization_code');assert.equal(p.get('scope'),'offline_access https://graph.microsoft.com/Calendars.Read');return Response.json(token);};
 assert.deepEqual(await exchangeCalendarOAuthCode(config,'fake-code',verifier,'read',fakeFetch),{refreshToken:'fake-refresh',grantedCalendarScopes:['https://graph.microsoft.com/calendars.read']});assert.equal(calls,1);
});
test('token rejection, missing refresh token and missing calendar scope fail closed',async()=>{
 for(const response of [Response.json({error:'private'},{status:400}),Response.json({...token,refresh_token:undefined}),Response.json({...token,scope:'User.Read'}),Response.json({...token,expires_in:0}),Response.json({...token,scope:'Calendars.ReadWrite'})]){let calls=0;await assert.rejects(exchangeCalendarOAuthCode(config,'fake-code',verifier,'read',async()=>{calls++;return response;}));assert.equal(calls,1);}
});
test('write consent accepts only the explicit Calendars.ReadWrite grant',async()=>{
 const fakeFetch:typeof fetch=async(_url,init)=>{const form=new URLSearchParams(String(init?.body));assert.equal(form.get('scope'),'offline_access https://graph.microsoft.com/Calendars.ReadWrite');return Response.json({...token,scope:'Calendars.ReadWrite'});};
 assert.deepEqual(await exchangeCalendarOAuthCode(config,'fake-code',verifier,'write',fakeFetch),{refreshToken:'fake-refresh',grantedCalendarScopes:['https://graph.microsoft.com/calendars.readwrite']});
 await assert.rejects(exchangeCalendarOAuthCode(config,'fake-code',verifier,'write',async()=>Response.json({...token,scope:'Calendars.Read'})));
});
test('verified write consent updates the existing connection without changing its active state',async()=>{
 const f=fixture({consume:async()=>({verifier,accessMode:'write',expectedRevision:3}),exchange:async(_code,_verifier,mode)=>{assert.equal(mode,'write');return{refreshToken:'fake-write-refresh',grantedCalendarScopes:['https://graph.microsoft.com/calendars.readwrite']};},store:async(input)=>{assert.equal(input.expected_revision,3);assert.equal(input.requested_access_mode,'write');return{credential_reference:connectionId,revision:4,connection_status:'connected'};}});
 const response=await handleCalendarOAuthCompletion(request(),f.deps);
 assert.deepEqual(await response.json(),{status:'authorization_saved',connectionId,connectionStatus:'connected',calendarWriteConsentGranted:true});
});
test('read-only scope cannot be stored as write consent and malformed saved result is not success',async()=>{
 const readOnly=fixture({consume:async()=>({verifier,accessMode:'write',expectedRevision:1}),exchange:async()=>({refreshToken:'fake-refresh',grantedCalendarScopes:['https://graph.microsoft.com/calendars.read']})});
 assert.equal((await handleCalendarOAuthCompletion(request(),readOnly.deps)).status,403);
 const malformed=fixture({store:async()=>({credential_reference:connectionId,revision:1,connection_status:'connected'})});
 assert.equal((await handleCalendarOAuthCompletion(request(),malformed.deps)).status,403);
});

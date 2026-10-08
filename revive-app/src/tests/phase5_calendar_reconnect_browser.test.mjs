import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconnectCalendarOAuth,completeCalendarOAuth} from '../services/calendarOAuthBrowser.ts';
const workspace='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',connection='33333333-3333-4333-8333-333333333333',state='s'.repeat(43),now=1000000;
function storage(){const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),values:()=>[...map.values()]};}
function authorization(){const url=new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');url.search=new URLSearchParams({client_id:user,state,response_type:'code',code_challenge_method:'S256',code_challenge:'c'.repeat(43),scope:'offline_access https://graph.microsoft.com/Calendars.Read',redirect_uri:'http://localhost:5180/calendar/outlook/callback'}).toString();return{authorizationUrl:url.href};}
function fake(){const calls=[];return{calls,invoke:async(name,body)=>{calls.push({name,body});if(name==='rev-calendar-reconnect')return{connectionId:connection,connectionStatus:'disconnected'};if(name==='rev-calendar-oauth-start')return authorization();if(name==='rev-calendar-oauth-complete')return{status:'authorization_saved',connectionId:connection,connectionStatus:'disconnected'};throw new Error('Unexpected endpoint');}};}
test('reconnect reuses connection and sends only identifiers; it never creates another row',async()=>{
 const s=storage(),f=fake();await reconnectCalendarOAuth(workspace,user,connection,s,f.invoke,now);assert.deepEqual(f.calls,[{name:'rev-calendar-reconnect',body:{workspaceId:workspace,connectionId:connection}},{name:'rev-calendar-oauth-start',body:{workspaceId:workspace,connectionId:connection}}]);const pending=JSON.parse(s.values()[0]);assert.equal(pending.connectionId,connection);assert.equal(pending.userId,user);assert.equal(pending.state,state);
});
test('fresh matching callback completes existing connection once and denies replay',async()=>{
 const s=storage(),f=fake();await reconnectCalendarOAuth(workspace,user,connection,s,f.invoke,now);await completeCalendarOAuth({code:'fake-code',state,failed:false},user,s,f.invoke,now+1);assert.equal(f.calls[2].body.connectionId,connection);await assert.rejects(completeCalendarOAuth({code:'fake-code',state,failed:false},user,s,f.invoke,now+2));assert.equal(f.calls.length,3);
});
test('bad IDs stop before storage changes or endpoint calls',async()=>{
 const s=storage();s.setItem('rev-calendar-oauth-pending','old');let calls=0;await assert.rejects(reconnectCalendarOAuth('bad',user,connection,s,async()=>{calls++;},now));assert.equal(calls,0);assert.deepEqual(s.values(),['old']);
});
test('reset clears abandoned browser state; mismatched or credential-bearing response refuses start',async()=>{
 for(const response of [{connectionId:workspace,connectionStatus:'disconnected'},{connectionId:connection,connectionStatus:'connected'},{connectionId:connection,connectionStatus:'disconnected',token:'private'}]){const s=storage();s.setItem('rev-calendar-oauth-pending','abandoned');let calls=0;await assert.rejects(reconnectCalendarOAuth(workspace,user,connection,s,async()=>{calls++;return response;},now));assert.equal(calls,1);assert.deepEqual(s.values(),[]);}
});
test('prepare or start failure is not retried and never saves a usable callback state',async()=>{
 for(const failure of ['rev-calendar-reconnect','rev-calendar-oauth-start']){const s=storage(),f=fake();let count=0;await assert.rejects(reconnectCalendarOAuth(workspace,user,connection,s,async(name,body)=>{if(name===failure){count++;throw new Error('uncertain');}return f.invoke(name,body);},now));assert.equal(count,1);const pending=s.values()[0];assert.ok(!pending||JSON.parse(pending).state==='');}
});
test('unsafe authorization destination is refused after reset',async()=>{
 const s=storage();await assert.rejects(reconnectCalendarOAuth(workspace,user,connection,s,async name=>name==='rev-calendar-reconnect'?{connectionId:connection,connectionStatus:'disconnected'}:{authorizationUrl:'https://evil.test'},now));assert.equal(JSON.parse(s.values()[0]).state,'');
});
test('panel provides reconnect for inactive rows and permits adding another connection',()=>{
 const source=readFileSync(new URL('../components/OutlookConnectionPanel.tsx',import.meta.url),'utf8');assert.match(source,/metadataStatus==='loading'\?/);assert.match(source,/metadataStatus==='error'\?/);assert.match(source,/metadata.connections.length\?'ADD OUTLOOK CONNECTION':'CONNECT OUTLOOK'/);assert.match(source,/\['revoked','expired','error','disconnected'\].includes\(connection.status\)/);assert.match(source,/RECONNECT OUTLOOK/);assert.match(source,/AUTHORIZE OUTLOOK/);assert.match(source,/reconnectCalendarOAuth\(workspaceId,userId,connectionId/);
});

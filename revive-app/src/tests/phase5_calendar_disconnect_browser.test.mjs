import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestCalendarDisconnect,loadCalendarConnectionMetadata} from '../services/calendarConnectionMetadata.ts';
const workspace='11111111-1111-4111-8111-111111111111',connection='22222222-2222-4222-8222-222222222222',calendar='33333333-3333-4333-8333-333333333333';
test('disconnect sends only identifiers once and accepts exact revoked result',async()=>{
 const calls=[];await requestCalendarDisconnect(workspace,connection,async(name,body)=>{calls.push({name,body});return{connectionId:connection,connectionStatus:'revoked'};});assert.deepEqual(calls,[{name:'rev-calendar-disconnect',body:{workspaceId:workspace,connectionId:connection}}]);
});
test('invalid identifiers stop before endpoint invocation',async()=>{
 let count=0;const invoke=async()=>{count++;};await assert.rejects(requestCalendarDisconnect('bad',connection,invoke));await assert.rejects(requestCalendarDisconnect(workspace,'bad',invoke));assert.equal(count,0);
});
test('mismatched IDs, unsafe state and credential-bearing responses fail closed',async()=>{
 for(const response of [{connectionId:workspace,connectionStatus:'revoked'},{connectionId:connection,connectionStatus:'connected'},{connectionId:connection,connectionStatus:'revoked',token:'private'},null,[]])await assert.rejects(requestCalendarDisconnect(workspace,connection,async()=>response));
});
test('endpoint uncertainty never automatically retries',async()=>{
 let count=0;await assert.rejects(requestCalendarDisconnect(workspace,connection,async()=>{count++;throw new Error('uncertain');}));assert.equal(count,1);
});
test('fresh metadata reconstructs revoked connection and inactive unselected calendars',async()=>{
 const result=await loadCalendarConnectionMetadata(workspace,async table=>table==='workspace_calendar_connections'?[{id:connection,connection_status:'revoked',provider_account_reference:'fake@example.test',authorized_by_user_id:null,calendar_write_consent_at:null}]:[{id:calendar,connection_id:connection,display_name:'Calendar',timezone:'Europe/London',active:false,is_selected:false}]);assert.equal(result.connections[0].status,'revoked');assert.equal(result.connections[0].writeConsentGranted,false);assert.equal(result.calendars[0].active,false);assert.equal(result.calendars[0].selected,false);
});
test('UI wiring keeps management role gate, explicit confirmation, cancel and repeat-click lock',()=>{
 const source=readFileSync(new URL('../components/OutlookConnectionPanel.tsx',import.meta.url),'utf8');assert.match(source,/if\(!callback&&!allowed\)return null/);assert.match(source,/\['owner','admin'\]/);assert.match(source,/DISCONNECT OUTLOOK/);assert.match(source,/CONFIRM DISCONNECT/);assert.match(source,/>CANCEL</);assert.match(source,/locked.current\|\|disconnectConfirmation!==connectionId/);assert.match(source,/connection.status!=='revoked'/);
});

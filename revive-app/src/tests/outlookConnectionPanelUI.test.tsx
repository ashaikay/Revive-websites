// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const workspaceA='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const connectionId='33333333-3333-4333-8333-333333333333';
const calendarId='44444444-4444-4444-8444-444444444444';
const callbackState='a'.repeat(43);
const mocks=vi.hoisted(()=>({invoke:vi.fn(),read:vi.fn(),membership:{data:{role:'owner',status:'active'},error:null}}));

vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke},from:(table:string)=>{
 let columns='',filters:[string,unknown][]=[];
 const query={
  select:(value:string)=>{columns=value;return query;},
  eq:(column:string,value:unknown)=>{filters=[...filters,[column,value]];return query;},
  maybeSingle:async()=>mocks.membership,
  then:(resolve:(value:unknown)=>unknown,reject:(reason:unknown)=>unknown)=>Promise.resolve(mocks.read(table,columns,filters)).then(resolve,reject),
 };
 return query;
}}}));
vi.mock('@/components/CalendarBusinessHoursPanel',()=>({CalendarBusinessHoursPanel:()=>null}));
vi.mock('@/services/calendarOAuthBrowser',async importOriginal=>{
 const actual=await importOriginal<typeof import('@/services/calendarOAuthBrowser')>();
 return{...actual,calendarOAuthReturn:{code:'mock-oauth-code',state:'a'.repeat(43),failed:false}};
});

import {OutlookConnectionPanel} from '@/components/OutlookConnectionPanel';
import {startCalendarOAuth} from '@/services/calendarOAuthBrowser';

async function openConnectionSetup(){
 fireEvent.click(await screen.findByText('Manage Outlook connections'));
}

let connectionRows:Record<string,unknown>[];
let calendarRows:Record<string,unknown>[];

beforeEach(()=>{
 vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','false');
 mocks.invoke.mockReset();
 mocks.read.mockClear();
 window.sessionStorage.removeItem('rev-calendar-oauth-pending');
 mocks.membership={data:{role:'owner',status:'active'},error:null};
 connectionRows=[{id:connectionId,connection_status:'connected',provider_account_reference:'client@example.test',authorized_by_user_id:userId,calendar_write_consent_at:null}];
 calendarRows=[{id:calendarId,connection_id:connectionId,display_name:'Client calendar',timezone:'Europe/London',is_selected:true,active:true}];
 mocks.read.mockImplementation((table:string,_columns:string,filters:[string,unknown][])=>{
  const requestedWorkspace=filters.find(([column])=>column==='workspace_id')?.[1];
  if(requestedWorkspace!==workspaceA)return{data:[],error:null};
  return{data:table==='workspace_calendar_connections'?connectionRows:calendarRows,error:null};
 });
});
afterEach(()=>{cleanup();window.sessionStorage.removeItem('rev-calendar-oauth-pending');vi.unstubAllEnvs();vi.restoreAllMocks();});

describe('mounted customer-managed Outlook connection panel',()=>{
 it('keeps the panel unavailable when the feature flag is off, including its callback route',()=>{
  const {container:regular}=render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  expect(regular).toBeEmptyDOMElement();
  expect(mocks.read).not.toHaveBeenCalled();
  cleanup();
  const {container:callback}=render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId} callback/>);
  expect(callback).toHaveTextContent('Outlook connection setup is unavailable.');
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it.each(['owner','admin'])('shows workspace-scoped controls to an active %s only',async role=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  mocks.membership={data:{role,status:'active'},error:null};
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  expect(await screen.findByText('client@example.test')).toBeInTheDocument();
  await openConnectionSetup();
  expect(screen.getByText('Client calendar')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'ADD OUTLOOK CONNECTION'})).toBeInTheDocument();
  const metadataReads=mocks.read.mock.calls.filter(call=>call[0]==='workspace_calendar_connections'||call[0]==='workspace_calendars') as [string,string,[string,unknown][]][];
  expect(metadataReads.length).toBeGreaterThanOrEqual(2);
  expect(metadataReads).toEqual(expect.arrayContaining([
   ['workspace_calendar_connections','id,connection_status,provider_account_reference,authorized_by_user_id,calendar_write_consent_at',[['workspace_id',workspaceA]]],
   ['workspace_calendars','id,connection_id,display_name,timezone,is_selected,active',[['workspace_id',workspaceA]]],
  ]));
  expect(metadataReads.every(([, ,filters])=>filters.every(([column,value])=>column!=='workspace_id'||value===workspaceA))).toBe(true);
 });

 it('offers a separately initiated write-consent flow only for the selected calendar',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await openConnectionSetup();
  expect(await screen.findByRole('button',{name:'AUTHORIZE CALENDAR CHANGES'})).toBeInTheDocument();
  expect(screen.getByText('This separately asks Outlook to allow calendar changes for the selected calendar. It does not enable bookings.')).toBeInTheDocument();
 });

 it('shows the saved write-consent status instead of offering another upgrade',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  connectionRows=[{...connectionRows[0],calendar_write_consent_at:'2026-10-09T12:00:00Z'}];
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  expect(await screen.findByText('Outlook calendar-change permission is authorized. Bookings remain disabled.')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'AUTHORIZE CALENDAR CHANGES'})).toBeNull();
 });

 it('lets an active workspace manager initiate consent without changing connection ownership',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  connectionRows=[{...connectionRows[0],authorized_by_user_id:'55555555-5555-4555-8555-555555555555'}];
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await openConnectionSetup();
  expect(await screen.findByRole('button',{name:'AUTHORIZE CALENDAR CHANGES'})).toBeInTheDocument();
 });

 it.each([
  ['member','active'],
  ['admin','suspended'],
 ])('does not show or load customer calendar metadata for %s/%s membership',async(role,status)=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  mocks.membership={data:{role,status},error:null};
  const {container}=render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(container).toBeEmptyDOMElement();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('offers the first connection after an empty workspace finishes loading',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  connectionRows=[];calendarRows=[];
  const readResolvers:Array<()=>void>=[];
  mocks.read.mockImplementation((table:string)=>new Promise(resolve=>{
   readResolvers.push(()=>resolve({data:table==='workspace_calendar_connections'?connectionRows:calendarRows,error:null}));
  }));
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  expect(await screen.findByRole('status')).toHaveTextContent('Loading Outlook connections...');
  expect(screen.queryByRole('button',{name:'CONNECT OUTLOOK'})).toBeNull();
  await act(async()=>{readResolvers.forEach(resolve=>resolve());});
  await openConnectionSetup();
  expect(await screen.findByText('No Outlook connections saved.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'CONNECT OUTLOOK'})).toBeInTheDocument();
 });

 it('shows connection-loading errors without offering creation until retry succeeds',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  mocks.read.mockImplementation(()=>({data:null,error:new Error('metadata unavailable')}));
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('Calendar connections could not be loaded.');
  expect(screen.queryByRole('button',{name:'ADD OUTLOOK CONNECTION'})).toBeNull();
  expect(screen.getByRole('button',{name:'RETRY LOADING CONNECTIONS'})).toBeInTheDocument();
 });

 it('reuses delegated OAuth to add another connection and reports start errors',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  let resolveCreate!:(value:{data:unknown;error:unknown})=>void;
  mocks.invoke.mockImplementation((name:string)=>{
   if(name==='rev-calendar-connection-create')return new Promise(resolve=>{resolveCreate=resolve;});
   if(name==='rev-calendar-oauth-start')return Promise.resolve({data:null,error:new Error('OAuth start unavailable')});
   throw new Error(`Unexpected endpoint ${name}`);
  });
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await screen.findByText('client@example.test');
  await openConnectionSetup();
  const addButton=screen.getByRole('button',{name:'ADD OUTLOOK CONNECTION'});
  fireEvent.click(addButton);
  expect(screen.getByRole('button',{name:'CONNECTING...'})).toBeDisabled();
  await act(async()=>{resolveCreate({data:{connectionId:mocks.invoke.mock.calls[0][1].body.requestId,connectionStatus:'disconnected'},error:null});});
  expect(await screen.findByRole('status')).toHaveTextContent('Outlook connection could not be started. Please try again.');
  expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual(['rev-calendar-connection-create','rev-calendar-oauth-start']);
  const createRequest=mocks.invoke.mock.calls[0][1].body;
  expect(Object.keys(createRequest).sort()).toEqual(['requestId','workspaceId']);
  expect(createRequest.workspaceId).toBe(workspaceA);
  expect(mocks.invoke.mock.calls[1][1].body).toEqual({workspaceId:workspaceA,connectionId:createRequest.requestId});
 });

 it('confirms and disconnects only the selected workspace connection, then reloads revoked metadata',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  mocks.invoke.mockImplementation(async(name:string,options:{body:Record<string,string>})=>{
   expect(name).toBe('rev-calendar-disconnect');
   expect(options).toEqual({body:{workspaceId:workspaceA,connectionId}});
   connectionRows=[{...connectionRows[0],connection_status:'revoked'}];
   calendarRows=[{...calendarRows[0],is_selected:false,active:false}];
   return{data:{connectionId,connectionStatus:'revoked'},error:null};
  });
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await screen.findByText('client@example.test');
  await openConnectionSetup();
  fireEvent.click(screen.getByRole('button',{name:'DISCONNECT OUTLOOK'}));
  const confirmation=screen.getByRole('group',{name:'Confirm Outlook disconnect'});
  fireEvent.click(within(confirmation).getByRole('button',{name:'CONFIRM DISCONNECT'}));
  expect(await screen.findByText('Outlook disconnected from REV. Stored access was removed. Existing calendar events are unchanged.')).toBeInTheDocument();
  expect(screen.getByText('Status: revoked')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'DISCONNECT OUTLOOK'})).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });

 it('offers the safe duplicate-account message and removes only the unfinished connection',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  const pendingConnectionId='55555555-5555-4555-8555-555555555555';
  connectionRows=[
   {id:connectionId,connection_status:'connected',provider_account_reference:'client@example.test',authorized_by_user_id:userId,calendar_write_consent_at:null},
   {id:pendingConnectionId,connection_status:'disconnected',provider_account_reference:null,authorized_by_user_id:userId,calendar_write_consent_at:null},
  ];
  mocks.invoke.mockImplementation(async(name:string,options:{body:Record<string,string>})=>{
   if(name==='rev-calendar-discover')return{data:null,error:{context:new Response(JSON.stringify({error:'Calendar connection unavailable.',code:'outlook_account_already_connected'}),{status:409,headers:{'Content-Type':'application/json'}})}};
   expect(name).toBe('rev-calendar-disconnect');
   expect(options).toEqual({body:{workspaceId:workspaceA,connectionId:pendingConnectionId}});
   connectionRows=connectionRows.map(row=>row.id===pendingConnectionId?{...row,connection_status:'revoked'}:row);
   return{data:{connectionId:pendingConnectionId,connectionStatus:'revoked'},error:null};
  });
  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await screen.findByText('client@example.test');
  await openConnectionSetup();
  const pending=screen.getByText('Status: disconnected').closest('.border');
  expect(pending).not.toBeNull();
  fireEvent.click(within(pending as HTMLElement).getByRole('button',{name:'DISCOVER CALENDARS'}));
  expect(await screen.findByRole('status')).toHaveTextContent('This Outlook account is already connected. Use the existing connection.');
  fireEvent.click(within(pending as HTMLElement).getByRole('button',{name:'REMOVE UNFINISHED CONNECTION'}));
  const confirmation=within(pending as HTMLElement).getByRole('group',{name:'Confirm Outlook disconnect'});
  expect(within(confirmation).getByText('Remove only this unfinished Outlook connection from REV? The existing connected account and its selected calendar will not be changed.')).toBeInTheDocument();
  fireEvent.click(within(confirmation).getByRole('button',{name:'CONFIRM REMOVE CONNECTION'}));
  expect(await screen.findByText('Outlook disconnected from REV. Stored access was removed. Existing calendar events are unchanged.')).toBeInTheDocument();
  expect(within(pending as HTMLElement).getByText('Status: revoked')).toBeInTheDocument();
  expect(screen.getByText('client@example.test')).toBeInTheDocument();
  expect(screen.getByText('Client calendar')).toHaveTextContent('Selected');
  expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual(['rev-calendar-discover','rev-calendar-disconnect']);
  expect(mocks.invoke.mock.calls[1][1].body).toEqual({workspaceId:workspaceA,connectionId:pendingConnectionId});
 });

 it('completes mocked authorization, returns to the panel, and discovers without reconnect or cleanup',async()=>{
  vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','true');
  connectionRows=[];calendarRows=[];
  const authorizationUrl=new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authorizationUrl.searchParams.set('client_id',userId);
  authorizationUrl.searchParams.set('state',callbackState);
  authorizationUrl.searchParams.set('redirect_uri',`${window.location.origin}/calendar/outlook/callback`);
  authorizationUrl.searchParams.set('response_type','code');
  authorizationUrl.searchParams.set('code_challenge_method','S256');
  authorizationUrl.searchParams.set('code_challenge','b'.repeat(43));
  authorizationUrl.searchParams.set('scope','offline_access https://graph.microsoft.com/Calendars.Read');
  mocks.invoke.mockImplementation(async(name:string,options:{body:Record<string,string>})=>{
   const body=options.body;
   if(name==='rev-calendar-connection-create'){
    connectionRows=[{id:body.requestId,connection_status:'disconnected',provider_account_reference:null,authorized_by_user_id:null,calendar_write_consent_at:null}];
    return{data:{connectionId:body.requestId,connectionStatus:'disconnected'},error:null};
   }
   if(name==='rev-calendar-oauth-start')return{data:{authorizationUrl:authorizationUrl.href},error:null};
   if(name==='rev-calendar-oauth-complete'){
    expect(body).toEqual({workspaceId:workspaceA,connectionId:connectionRows[0].id,state:callbackState,code:'mock-oauth-code'});
    connectionRows=[{...connectionRows[0],authorized_by_user_id:userId}];
    return{data:{connectionId:connectionRows[0].id,connectionStatus:'disconnected',status:'authorization_saved'},error:null};
   }
   if(name==='rev-calendar-discover'){
    expect(body).toEqual({workspaceId:workspaceA,connectionId:connectionRows[0].id,timezone:expect.any(String)});
    connectionRows=[{...connectionRows[0],connection_status:'connected'}];
    return{data:{connectionId:connectionRows[0].id,connectionStatus:'connected',calendarCount:1},error:null};
   }
   throw new Error(`Unexpected endpoint ${name}`);
  });
  await startCalendarOAuth(workspaceA,userId,window.sessionStorage,async(name,body)=>{
   const{data,error}=await mocks.invoke(name,{body});
   if(error)throw error;
   return data;
  },Date.now());
  expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual(['rev-calendar-connection-create','rev-calendar-oauth-start']);

  const callbackView=render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId} callback/>);
  fireEvent.click(screen.getByRole('button',{name:'SAVE OUTLOOK AUTHORIZATION'}));
  expect(await screen.findByText('Outlook authorization saved. Return to REV and discover calendars to finish setting up read access.')).toBeInTheDocument();
  expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual(['rev-calendar-connection-create','rev-calendar-oauth-start','rev-calendar-oauth-complete']);
  callbackView.unmount();

  render(<OutlookConnectionPanel workspaceId={workspaceA} userId={userId}/>);
  await openConnectionSetup();
  const discoverButton=await screen.findByRole('button',{name:'DISCOVER CALENDARS'});
  expect(mocks.invoke.mock.calls.map(([name])=>name)).not.toContain('rev-calendar-reconnect');
  fireEvent.click(discoverButton);
  expect(await screen.findByText('1 calendar discovered. No calendar is selected and bookings remain disabled.')).toBeInTheDocument();
  expect(mocks.invoke.mock.calls.map(([name])=>name)).toEqual(['rev-calendar-connection-create','rev-calendar-oauth-start','rev-calendar-oauth-complete','rev-calendar-discover']);
  expect(mocks.invoke.mock.calls.some(([name])=>name==='rev-calendar-reconnect'||name==='rev-calendar-disconnect')).toBe(false);
 });
});

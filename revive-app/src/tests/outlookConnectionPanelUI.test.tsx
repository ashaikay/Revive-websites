// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';

const workspaceA='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const connectionId='33333333-3333-4333-8333-333333333333';
const calendarId='44444444-4444-4444-8444-444444444444';
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

import {OutlookConnectionPanel} from '@/components/OutlookConnectionPanel';

let connectionRows:Record<string,unknown>[];
let calendarRows:Record<string,unknown>[];

beforeEach(()=>{
 vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED','false');
 mocks.invoke.mockReset();
 mocks.read.mockClear();
 window.sessionStorage.removeItem('rev-calendar-oauth-pending');
 mocks.membership={data:{role:'owner',status:'active'},error:null};
 connectionRows=[{id:connectionId,connection_status:'connected',provider_account_reference:'client@example.test',authorized_by_user_id:userId}];
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
  expect(screen.getByText('Client calendar')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'ADD OUTLOOK CONNECTION'})).toBeInTheDocument();
  const metadataReads=mocks.read.mock.calls.filter(call=>call[0]==='workspace_calendar_connections'||call[0]==='workspace_calendars') as [string,string,[string,unknown][]][];
  expect(metadataReads.length).toBeGreaterThanOrEqual(2);
  expect(metadataReads).toEqual(expect.arrayContaining([
   ['workspace_calendar_connections','id,connection_status,provider_account_reference,authorized_by_user_id',[['workspace_id',workspaceA]]],
   ['workspace_calendars','id,connection_id,display_name,timezone,is_selected,active',[['workspace_id',workspaceA]]],
  ]));
  expect(metadataReads.every(([, ,filters])=>filters.every(([column,value])=>column!=='workspace_id'||value===workspaceA))).toBe(true);
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
  fireEvent.click(screen.getByRole('button',{name:'DISCONNECT OUTLOOK'}));
  const confirmation=screen.getByRole('group',{name:'Confirm Outlook disconnect'});
  fireEvent.click(within(confirmation).getByRole('button',{name:'CONFIRM DISCONNECT'}));
  expect(await screen.findByText('Outlook disconnected from REV. Stored access was removed. Existing calendar events are unchanged.')).toBeInTheDocument();
  expect(screen.getByText('Status: revoked')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'DISCONNECT OUTLOOK'})).toBeNull();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
 });
});

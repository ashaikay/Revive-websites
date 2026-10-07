import type {ReactElement,ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {AnnualLeaveAttempt,AnnualLeaveWorkspaceModel} from '@/services/annualLeave';
import type {Worker} from '@/services/schedulingWorkers';

const mocks=vi.hoisted(()=>({states:[] as unknown[],setters:[] as ReturnType<typeof vi.fn>[],invoke:vi.fn(),range:vi.fn(),order:vi.fn(),removeItem:vi.fn(),setItem:vi.fn(),dispatch:vi.fn()}));
vi.mock('react',async importOriginal=>{const actual=await importOriginal<typeof import('react')>();return{...actual,useEffect:vi.fn(),useRef:<T,>(value:T)=>({current:value}),useState:<T,>(initial:T)=>{const setter=vi.fn();mocks.setters.push(setter);return[mocks.states.length?mocks.states.shift() as T:initial,setter] as const;}};});
vi.mock('@/data/supabaseClient',()=>{const query:{select:(value:string)=>typeof query;eq:(key:string,value:unknown)=>typeof query;or:(value:string)=>typeof query;in:(key:string,value:unknown[])=>typeof query;order:(column:string,options:unknown)=>typeof query;range:(from:number,to:number)=>unknown}={select:()=>query,eq:()=>query,or:()=>query,in:()=>query,order:(column,options)=>{mocks.order(column,options);return query;},range:(from,to)=>mocks.range(from,to)};return{supabaseClient:{functions:{invoke:mocks.invoke},from:()=>query}};});

import {AnnualLeaveHistory,AnnualLeaveView} from '@/components/AnnualLeaveView';

const ws='11111111-1111-4111-8111-111111111111',user='22222222-2222-4222-8222-222222222222',workerId='33333333-3333-4333-8333-333333333333',accountId='44444444-4444-4444-8444-444444444444',absenceId='55555555-5555-4555-8555-555555555555',unavailabilityId='66666666-6666-4666-8666-666666666666',requestId='77777777-7777-4777-8777-777777777777';
const worker:Worker={workspaceId:ws,workerId,displayName:'Alex Worker',roleLabels:[],skillTags:[],active:true,version:1};
const account={accountId,workerId,leaveYearStart:'2026-01-01',leaveYearEndExclusive:'2027-01-01',configuredAllowanceMinutes:12000,adjustmentTotalMinutes:60,recordedLeaveMinutes:120,remainingMinutes:11940,hoursPerDayMinutes:450,bankHolidayTreatment:'included' as const,version:3};
const absence={absenceId,unavailabilityId,workerId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',timezone:'Europe/London',totalDeductionMinutes:450,status:'confirmed' as const,version:1,accountIds:[accountId],createdAt:'2026-04-01T00:00:00.000Z',cancelledAt:null};
const policy={policyId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',workerId,version:1,effectiveFromLeaveYear:2026,allowanceInputUnit:'days' as const,allowanceInputValue:28,allowanceMinutes:12600,hoursPerDayMinutes:450,leaveYearStartMonth:1,leaveYearStartDay:1,bankHolidayTreatment:'included' as const};
const model:AnnualLeaveWorkspaceModel={workspaceId:ws,workerId,timezone:'Europe/London',policies:[policy],accounts:[account],adjustments:[],absences:[absence],legacyLeave:[],calendars:[],assignedCalendarId:null,assignmentVersion:0,calendarYears:[],holidays:[]};
const drafts={allowanceUnit:'days',allowanceValue:'28',workingDayHours:'7.5',leaveYearStart:'2026-01-01',holidayTreatment:'included',adjustmentUnit:'days',adjustmentValue:'',adjustmentReason:'',calendarName:'',calendarRegion:'GB-ENG',calendarId:'',calendarYear:'2026',holidayDate:'',holidayName:'',recordMode:'full',startDate:'2026-05-01',endDate:'2026-05-01',startTime:'09:00',endTime:'17:00'};
function states(pending:AnnualLeaveAttempt|null=null,value:AnnualLeaveWorkspaceModel|null=model,settingsOpen=false,draftValue=drafts,setupEditing=false,adjustmentsOpen=false,holidaysEditing=false){return[workerId,value,value?.accounts[0]?.leaveYearStart??'',draftValue,'',false,pending,false,false,settingsOpen,setupEditing,adjustmentsOpen,holidaysEditing];}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');if(node&&typeof node==='object'&&'props'in node)return text((node as ReactElement<{children?:ReactNode}>).props.children);return'';}
function button(node:ReactNode,label:string):ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>{if(node&&typeof node==='object'&&'props'in node){const element=node as ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>;if(element.type==='button'&&text(element.props.children)===label)return element;for(const child of Array.isArray(element.props.children)?element.props.children:[element.props.children]){try{return button(child,label);}catch{/* Continue. */}}}throw Error(`Button ${label} not found`);}
function component<P>(node:ReactNode,type:(props:P)=>ReactNode):ReactElement<P>{if(node&&typeof node==='object'&&'props'in node){const element=node as ReactElement<P&{children?:ReactNode}>;if(element.type===type)return element;for(const child of Array.isArray(element.props.children)?element.props.children:[element.props.children]){try{return component(child,type);}catch{/* Continue. */}}}throw Error('Component not found');}
function render(state:unknown[]){mocks.states=state;mocks.setters=[];const tree=AnnualLeaveView({workspaceId:ws,userId:user,workers:[worker]});return{tree,markup:renderToStaticMarkup(tree)};}

describe('Annual Leave Stage 3 interactions',()=>{
 beforeEach(()=>{mocks.invoke.mockReset();mocks.range.mockReset();mocks.range.mockResolvedValue({data:null,error:{message:'read unavailable'}});mocks.order.mockReset();mocks.removeItem.mockReset();mocks.setItem.mockReset();mocks.dispatch.mockReset();vi.stubGlobal('window',{sessionStorage:{getItem:()=>null,setItem:mocks.setItem,removeItem:mocks.removeItem},dispatchEvent:mocks.dispatch});vi.stubGlobal('crypto',{randomUUID:()=>requestId});});
 it('keeps everyday leave simple and moves a worker-specific guided flow behind Leave settings',()=>{
  const everyday=render(states()).markup,settings=render(states(null,model,true)).markup;
  expect(everyday).toContain('Allowance');expect(everyday).toContain('Used');expect(everyday).toContain('Remaining');expect(everyday).toContain('Add annual leave');expect(everyday).toContain('Custom hours');expect(everyday).toContain('Refresh');expect(everyday).toContain('Leave settings');expect(everyday).not.toContain('1. Allowance and leave year');
  expect(settings).toContain('These settings apply only to the selected worker.');expect(settings).toContain('Edit allowance and leave year');expect(settings).not.toContain('Save worker leave settings');expect(settings).toContain('Allowance adjustments');expect(settings).not.toContain('Save allowance change');expect(settings).toContain('Bank/public holidays');expect(settings).toContain('These are public holidays, not this worker&#x27;s annual leave.');expect(settings).toContain('placeholder=\"e.g. England and Wales\"');expect(settings).toContain('REV never invents holiday dates');expect(settings).not.toMatch(/account|posting|revision|authoritative|exact accounting/i);
 });
 it('uses styled fields and hides completed holiday setup behind Edit',()=>{
  const calendarId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',complete={...model,calendars:[{calendarId,name:'England and Wales',regionCode:'GB-ENG',status:'active' as const,version:1}],assignedCalendarId:calendarId,assignmentVersion:1,calendarYears:[{calendarId,calendarYear:2026,revision:2,confirmedRevision:2,confirmedAt:'2026-01-01T00:00:00.000Z'}]};
  const markup=render(states(null,complete,true,{...drafts,calendarId},false,false,false)).markup;
  expect(markup).toContain('input-field bg-white');expect(markup).toContain('Edit bank/public holidays');expect(markup).not.toContain('New calendar name');
  const expanded=render(states(null,complete,true,{...drafts,calendarId},false,true,true)).markup;
  expect(expanded).toContain('Save allowance change');expect(expanded).toContain('New calendar name');expect(expanded).toContain('Bank holiday date');expect(expanded).toContain('Bank holiday name');expect(expanded).toContain('Add bank holiday');expect(expanded).toContain('Changes to a shared calendar affect every worker assigned to it.');
 });
 it('shows setup rather than an empty leave-year selector and resumes after worker settings are saved',()=>{
  const missing={...model,policies:[],accounts:[],absences:[]},partial={...missing,policies:[policy]};
  const missingView=render(states(null,missing)).markup,partialView=render(states(null,partial,true));
  expect(missingView).toContain('Set up leave for this worker');expect(missingView).not.toContain('Leave year<select');
  expect(partialView.markup).toContain('Step 1 complete for this worker.');expect(button(partialView.tree,'Create leave year').props.disabled).toBeFalsy();
 });
 it('blocks blank calendar creation before retaining or submitting a request',()=>{
  const {tree}=render(states(null,model,true));
  const create=button(tree,'Create holiday calendar');
  expect(create.props.disabled).toBe(true);
  create.props.onClick?.();
  expect(mocks.setters[4]).toHaveBeenCalledWith('Enter a calendar name.');
  expect(mocks.setItem).not.toHaveBeenCalled();expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('converts familiar day and hour settings to worker-specific integer minutes',async()=>{
  mocks.invoke.mockImplementation(()=>new Promise(()=>{}));
  const {tree}=render(states(null,model,true,drafts,true));button(tree,'Save worker leave settings').props.onClick?.();
  await vi.waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('rev-annual-leave-policy-save',{body:expect.objectContaining({workspaceId:ws,workerId,allowanceInputUnit:'days',allowanceInputValue:28,allowanceMinutes:12600,hoursPerDayMinutes:450,leaveYearStartMonth:1,leaveYearStartDay:1,expectedVersion:1})}));
 });
 it.each([
  ['full day',drafts,'2026-04-30T23:00:00.000Z','2026-05-01T23:00:00.000Z'],
  ['custom hours',{...drafts,recordMode:'partial' as const,startTime:'09:15',endTime:'13:45'},'2026-05-01T08:15:00.000Z','2026-05-01T12:45:00.000Z'],
 ])('submits %s leave in the worker timezone without a browser deduction estimate',async(_label,draftValue,startAt,endAt)=>{
  mocks.invoke.mockImplementation(()=>new Promise(()=>{}));
  const {tree,markup}=render(states(null,model,false,draftValue));
  expect(markup).toContain('Your saved working hours determine the final balance change.');expect(markup).not.toMatch(/estimated deduction/i);
  button(tree,'Save annual leave').props.onClick?.();
  await vi.waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('rev-annual-leave-record',{body:{workspaceId:ws,workerId,requestId,startAt,endAt,expectedAccounts:[{accountId,version:3}]}}));
 });
 it('retries the exact retained recording request and requests the planner refresh only after confirmation',async()=>{
  const body={workspaceId:ws,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:3}]},pending:AnnualLeaveAttempt={operation:'record',workspaceId:ws,workerId,requestId,body};
  mocks.invoke.mockResolvedValue({data:{absenceId,unavailabilityId,workspaceId:ws,workerId,startAt:body.startAt,endAt:body.endAt,timezone:'Europe/London',status:'confirmed',version:1,totalDeductionMinutes:450,accounts:[{accountId,version:4,deductedMinutes:450,remainingMinutes:11490}]},error:null});
  const {tree}=render(states(pending));button(tree,'Retry same change').props.onClick?.();
  await vi.waitFor(()=>{expect(mocks.invoke).toHaveBeenCalledWith('rev-annual-leave-record',{body});expect(mocks.removeItem).toHaveBeenCalled();expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'rev-scheduling-changed'}));});
 });
 it('retains an unknown exact retry and does not refresh the planner',async()=>{
  const body={workspaceId:ws,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:3}]},pending:AnnualLeaveAttempt={operation:'record',workspaceId:ws,workerId,requestId,body};
  mocks.invoke.mockResolvedValue({data:null,error:new Error('network')});
  const {tree}=render(states(pending));button(tree,'Retry same change').props.onClick?.();
  await vi.waitFor(()=>expect(mocks.setters[4]).toHaveBeenCalledWith(expect.stringMatching(/could not confirm what happened/)));
  expect(mocks.removeItem).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
 });
 it('refreshes explicitly without submitting or clearing a pending request and fails closed on read failure',async()=>{
  const body={workspaceId:ws,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:3}]},pending:AnnualLeaveAttempt={operation:'record',workspaceId:ws,workerId,requestId,body};
  const {tree}=render(states(pending));button(tree,'Refresh').props.onClick?.();
  await vi.waitFor(()=>expect(mocks.setters[1]).toHaveBeenCalledWith(null));
  expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.removeItem).not.toHaveBeenCalled();expect(mocks.setItem).not.toHaveBeenCalled();expect(mocks.setters[6]).not.toHaveBeenCalled();
 });
 it('cancels accounted leave with current account revisions and refreshes the planner after exact reversal',async()=>{
 mocks.invoke.mockResolvedValue({data:{absenceId,workspaceId:ws,workerId,status:'cancelled',version:2,reversedMinutes:450,accounts:[{accountId,version:4,remainingMinutes:12390}]},error:null});
 const {tree}=render(states()),history=component<Parameters<typeof AnnualLeaveHistory>[0]>(tree,AnnualLeaveHistory);history.props.onCancel(absence);
 await vi.waitFor(()=>{expect(mocks.invoke).toHaveBeenCalledWith('rev-annual-leave-cancel',{body:{workspaceId:ws,requestId,absenceId,expectedVersion:1,expectedAccounts:[{accountId,version:3}]}});expect(mocks.setItem).toHaveBeenCalled();expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'rev-scheduling-changed'}));});
 });
});

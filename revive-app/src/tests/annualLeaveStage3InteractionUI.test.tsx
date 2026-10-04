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
const model:AnnualLeaveWorkspaceModel={workspaceId:ws,workerId,timezone:'Europe/London',policies:[],accounts:[account],adjustments:[],absences:[absence],legacyLeave:[],calendars:[],assignedCalendarId:null,assignmentVersion:0,calendarYears:[],holidays:[]};
const drafts={policyScope:'workspace',policyYear:'2026',allowanceUnit:'days',allowanceValue:'28',hoursPerDay:'450',yearMonth:'1',yearDay:'1',holidayTreatment:'included',accountStart:'2026-01-01',adjustmentMinutes:'',adjustmentReason:'',calendarName:'',calendarRegion:'GB-ENG',calendarId:'',calendarYear:'2026',holidayDate:'',holidayName:'',recordMode:'full',startDate:'2026-05-01',endDate:'2026-05-01',startTime:'09:00',endTime:'17:00'};
function states(pending:AnnualLeaveAttempt|null=null,value:AnnualLeaveWorkspaceModel|null=model){return[workerId,value,'2026-01-01',drafts,'',false,pending,false,false];}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');if(node&&typeof node==='object'&&'props'in node)return text((node as ReactElement<{children?:ReactNode}>).props.children);return'';}
function button(node:ReactNode,label:string):ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>{if(node&&typeof node==='object'&&'props'in node){const element=node as ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>;if(element.type==='button'&&text(element.props.children)===label)return element;for(const child of Array.isArray(element.props.children)?element.props.children:[element.props.children]){try{return button(child,label);}catch{/* Continue. */}}}throw Error(`Button ${label} not found`);}
function component<P>(node:ReactNode,type:(props:P)=>ReactNode):ReactElement<P>{if(node&&typeof node==='object'&&'props'in node){const element=node as ReactElement<P&{children?:ReactNode}>;if(element.type===type)return element;for(const child of Array.isArray(element.props.children)?element.props.children:[element.props.children]){try{return component(child,type);}catch{/* Continue. */}}}throw Error('Component not found');}
function render(state:unknown[]){mocks.states=state;mocks.setters=[];const tree=AnnualLeaveView({workspaceId:ws,userId:user,workers:[worker]});return{tree,markup:renderToStaticMarkup(tree)};}

describe('Annual Leave Stage 3 interactions',()=>{
 beforeEach(()=>{mocks.invoke.mockReset();mocks.range.mockReset();mocks.range.mockResolvedValue({data:null,error:{message:'read unavailable'}});mocks.order.mockReset();mocks.removeItem.mockReset();mocks.setItem.mockReset();mocks.dispatch.mockReset();vi.stubGlobal('window',{sessionStorage:{getItem:()=>null,setItem:mocks.setItem,removeItem:mocks.removeItem},dispatchEvent:mocks.dispatch});vi.stubGlobal('crypto',{randomUUID:()=>requestId});});
 it('renders setup behind labelled sections and records in the explicit worker timezone without a browser estimate',()=>{
  const {markup}=render(states());
  expect(markup).toContain('POLICY, ACCOUNT AND BALANCE ADJUSTMENT SETUP');expect(markup).toContain('CALENDAR, WORKER ASSIGNMENT AND HOLIDAY SETUP');expect(markup).toContain('RECORD CONFIRMED ANNUAL LEAVE');expect(markup).toContain('Worker timezone:');expect(markup).toContain('Europe/London');expect(markup).toContain('no browser estimate is shown');expect(markup).toContain('Manager-recorded leave is confirmed immediately');
 });
 it('retries the exact retained recording request and requests the planner refresh only after confirmation',async()=>{
  const body={workspaceId:ws,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:3}]},pending:AnnualLeaveAttempt={operation:'record',workspaceId:ws,workerId,requestId,body};
  mocks.invoke.mockResolvedValue({data:{absenceId,unavailabilityId,workspaceId:ws,workerId,startAt:body.startAt,endAt:body.endAt,timezone:'Europe/London',status:'confirmed',version:1,totalDeductionMinutes:450,accounts:[{accountId,version:4,deductedMinutes:450,remainingMinutes:11490}]},error:null});
  const {tree}=render(states(pending));button(tree,'RETRY SAME ANNUAL LEAVE CHANGE').props.onClick?.();
  await vi.waitFor(()=>{expect(mocks.invoke).toHaveBeenCalledWith('rev-annual-leave-record',{body});expect(mocks.removeItem).toHaveBeenCalled();expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'rev-scheduling-changed'}));});
 });
 it('retains an unknown exact retry and does not refresh the planner',async()=>{
  const body={workspaceId:ws,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:3}]},pending:AnnualLeaveAttempt={operation:'record',workspaceId:ws,workerId,requestId,body};
  mocks.invoke.mockResolvedValue({data:null,error:new Error('network')});
  const {tree}=render(states(pending));button(tree,'RETRY SAME ANNUAL LEAVE CHANGE').props.onClick?.();
  await vi.waitFor(()=>expect(mocks.setters[4]).toHaveBeenCalledWith(expect.stringMatching(/Outcome unknown/)));
  expect(mocks.removeItem).not.toHaveBeenCalled();expect(mocks.dispatch).not.toHaveBeenCalled();
 });
 it('refreshes explicitly without submitting or clearing a pending request and fails closed on read failure',async()=>{
  const body={workspaceId:ws,workerId,requestId,startAt:'2026-05-01T00:00:00.000Z',endAt:'2026-05-02T00:00:00.000Z',expectedAccounts:[{accountId,version:3}]},pending:AnnualLeaveAttempt={operation:'record',workspaceId:ws,workerId,requestId,body};
  const {tree}=render(states(pending));button(tree,'REFRESH AUTHORITATIVE LEAVE DATA').props.onClick?.();
  await vi.waitFor(()=>expect(mocks.setters[1]).toHaveBeenCalledWith(null));
  expect(mocks.invoke).not.toHaveBeenCalled();expect(mocks.removeItem).not.toHaveBeenCalled();expect(mocks.setItem).not.toHaveBeenCalled();expect(mocks.setters[6]).not.toHaveBeenCalled();
 });
 it('cancels accounted leave with current account revisions and refreshes the planner after exact reversal',async()=>{
 mocks.invoke.mockResolvedValue({data:{absenceId,workspaceId:ws,workerId,status:'cancelled',version:2,reversedMinutes:450,accounts:[{accountId,version:4,remainingMinutes:12390}]},error:null});
 const {tree}=render(states()),history=component<Parameters<typeof AnnualLeaveHistory>[0]>(tree,AnnualLeaveHistory);history.props.onCancel(absence);
 await vi.waitFor(()=>{expect(mocks.invoke).toHaveBeenCalledWith('rev-annual-leave-cancel',{body:{workspaceId:ws,requestId,absenceId,expectedVersion:1,expectedAccounts:[{accountId,version:3}]}});expect(mocks.setItem).toHaveBeenCalled();expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({type:'rev-scheduling-changed'}));});
 });
});

import type {ReactElement,ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const mocks=vi.hoisted(()=>({states:[] as unknown[],invoke:vi.fn()}));

vi.mock('react',async importOriginal=>{
 const actual=await importOriginal<typeof import('react')>();
 return{...actual,useEffect:vi.fn(),useRef:<T,>(value:T)=>({current:value}),useState:<T,>(initial:T)=>[mocks.states.length?mocks.states.shift() as T:initial,vi.fn()] as const};
});

vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke}}}));

import {WorkerWorkingPatternPanel} from '@/components/WorkerWorkingPatternPanel';
import {WorkerUnavailabilityPanel} from '@/components/WorkerUnavailabilityPanel';
import {schedulingParentLock} from '@/services/schedulingRecovery';
import type {PatternAttempt} from '@/services/workerWorkingPatterns';
import type {LeaveAttempt} from '@/services/workerUnavailability';

const workspaceId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const workerId='33333333-3333-4333-8333-333333333333';
const patternRequest:PatternAttempt={workspaceId,workerId,requestId:'44444444-4444-4444-8444-444444444444',timezone:'Europe/London',workingDays:[1,5],startLocal:'09:00',endLocal:'17:00',effectiveFrom:'2026-10-01',effectiveUntil:null,expectedVersion:0};
const leaveRequest:LeaveAttempt={workspaceId,workerId,requestId:'55555555-5555-4555-8555-555555555555',unavailabilityId:null,startAt:'2026-10-08T09:00:00.000Z',endAt:'2026-10-08T12:00:00.000Z',category:'unavailable',status:'active',expectedVersion:0};
const never=new Promise<never>(()=>{});

function patternStates(pending:PatternAttempt|null){return[{timezone:'Europe/London',workingDays:[1,5],startLocal:'09:00',endLocal:'17:00',effectiveFrom:'2026-10-01',effectiveUntil:'',version:0},true,false,'',pending,false];}
function leaveStates(pending:LeaveAttempt|null){return[[],true,false,pending,false,'',{record:null,start:'',end:'',category:'unavailable'},false,null,'Europe/London','Europe/London',new Set<string>(),null,null];}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');if(node&&typeof node==='object'&&'props'in node)return text((node as ReactElement<{children?:ReactNode}>).props.children);return'';}
function button(node:ReactNode,label:string):ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>{if(node&&typeof node==='object'&&'props'in node){const element=node as ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>;if(element.type==='button'&&text(element.props.children)===label)return element;const children=element.props.children;for(const child of Array.isArray(children)?children:[children]){try{return button(child,label);}catch{/* Continue through the rendered tree. */}}}throw new Error(`Button ${label} not found`);}

describe('Scheduling parent recovery lock',()=>{
 beforeEach(()=>{mocks.states=[];mocks.invoke.mockReset();mocks.invoke.mockReturnValue(never);});

 it('blocks new child edits but renders enabled retries that send unchanged retained requests',()=>{
  const parent=schedulingParentLock({busy:false,pendingWorkerSave:true,storageBlocked:false,ready:true});
  mocks.states=patternStates(patternRequest);const patternTree=WorkerWorkingPatternPanel({workspaceId,userId,workerId,active:true,disabled:parent.editsBlocked,retryDisabled:parent.retriesBlocked,parentDisabledReason:parent.reason});
  const patternMarkup=renderToStaticMarkup(patternTree);expect(patternMarkup).toContain('<fieldset disabled=""');const patternRetry=button(patternTree,'RETRY SAME PATTERN SAVE');expect(patternRetry.props.disabled).toBe(false);patternRetry.props.onClick?.();
  expect(mocks.invoke).toHaveBeenCalledWith('rev-worker-pattern-save',{body:patternRequest});

  mocks.invoke.mockClear();mocks.states=leaveStates(leaveRequest);const leaveTree=WorkerUnavailabilityPanel({workspaceId,userId,workerId,active:true,disabled:parent.editsBlocked,retryDisabled:parent.retriesBlocked,parentDisabledReason:parent.reason});
  const leaveMarkup=renderToStaticMarkup(leaveTree);expect(leaveMarkup).toContain('ADD UNAVAILABLE / SICKNESS</button>');expect(leaveMarkup).toMatch(/<button[^>]*disabled=""[^>]*>ADD UNAVAILABLE \/ SICKNESS/);const leaveRetry=button(leaveTree,'RETRY SAME PERIOD SAVE');expect(leaveRetry.props.disabled).toBe(false);leaveRetry.props.onClick?.();
  expect(mocks.invoke).toHaveBeenCalledWith('rev-worker-unavailability-save',{body:leaveRequest});
 });

 it.each([
  ['busy',{busy:true,pendingWorkerSave:true,storageBlocked:false,ready:true}],
  ['loading',{busy:false,pendingWorkerSave:false,storageBlocked:false,ready:false}],
  ['storage failure',{busy:false,pendingWorkerSave:true,storageBlocked:true,ready:true}],
 ])('parent %s state disables pattern and leave retries',(_label,state)=>{
  const parent=schedulingParentLock(state);
  mocks.states=patternStates(patternRequest);const patternTree=WorkerWorkingPatternPanel({workspaceId,userId,workerId,active:true,disabled:parent.editsBlocked,retryDisabled:parent.retriesBlocked,parentDisabledReason:parent.reason});expect(button(patternTree,'RETRY SAME PATTERN SAVE').props.disabled).toBe(true);
  mocks.states=leaveStates(leaveRequest);const leaveTree=WorkerUnavailabilityPanel({workspaceId,userId,workerId,active:true,disabled:parent.editsBlocked,retryDisabled:parent.retriesBlocked,parentDisabledReason:parent.reason});expect(button(leaveTree,'RETRY SAME PERIOD SAVE').props.disabled).toBe(true);
  expect(mocks.invoke).not.toHaveBeenCalled();
 });

 it('labels legacy cancellation separately and never offers it for accounted Stage 2 leave',()=>{
  const legacy={unavailabilityId:'66666666-6666-4666-8666-666666666666',workspaceId,workerId,startAt:'2026-01-02T09:00:00.000Z',endAt:'2026-01-02T17:00:00.000Z',category:'leave' as const,status:'active' as const,version:1};
  mocks.states=[[legacy],true,false,null,false,'',{record:null,start:'',end:'',category:'unavailable'},false,null,'Europe/London','Europe/London',new Set<string>(),null,null];
  const legacyMarkup=renderToStaticMarkup(WorkerUnavailabilityPanel({workspaceId,userId,workerId,active:true}));
  expect(legacyMarkup).toContain('CANCEL HISTORICAL LEAVE (NO BALANCE CHANGE)');
  expect(legacyMarkup).not.toContain('cancel through Annual Leave');
  mocks.states=[[legacy],true,false,null,false,'',{record:null,start:'',end:'',category:'unavailable'},false,null,'Europe/London','Europe/London',new Set([legacy.unavailabilityId]),null,null];
  const accountedMarkup=renderToStaticMarkup(WorkerUnavailabilityPanel({workspaceId,userId,workerId,active:true}));
  expect(accountedMarkup).toContain('cancel through Annual Leave for an exact balance reversal');
  expect(accountedMarkup).not.toContain('CANCEL HISTORICAL LEAVE (NO BALANCE CHANGE)');
 });
});
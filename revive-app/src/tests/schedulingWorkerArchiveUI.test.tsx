import type {ReactElement,ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Worker,WorkerSaveAttempt} from '@/services/schedulingWorkers';

const mocks=vi.hoisted(()=>({states:[] as unknown[],invoke:vi.fn()}));
vi.mock('react',async importOriginal=>{const actual=await importOriginal<typeof import('react')>();return{...actual,useEffect:vi.fn(),useRef:<T,>(value:T)=>({current:value}),useState:<T,>(initial:T)=>[mocks.states.length?mocks.states.shift() as T:initial,vi.fn()] as const};});
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{functions:{invoke:mocks.invoke}}}));
vi.mock('@/components/SchedulingWeeklyPlanner',()=>({SchedulingWeeklyPlanner:()=>null}));
vi.mock('@/components/SchedulingJobsPanel',()=>({SchedulingJobsPanel:()=>null}));
vi.mock('@/components/WorkerWorkingPatternPanel',()=>({WorkerWorkingPatternPanel:()=>null}));
vi.mock('@/components/WorkerUnavailabilityPanel',()=>({WorkerUnavailabilityPanel:()=>null}));

import {SchedulingModule} from '@/components/SchedulingModule';

const workspaceId='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const active:Worker={workspaceId,workerId:'33333333-3333-4333-8333-333333333333',displayName:'Active Worker',roleLabels:['Support'],skillTags:['Phone'],active:true,version:2};
const archived:Worker={workspaceId,workerId:'44444444-4444-4444-8444-444444444444',displayName:'Archived Worker',roleLabels:['Admin'],skillTags:[],active:false,version:3};
const pendingArchive:WorkerSaveAttempt={workspaceId,requestId:'55555555-5555-4555-8555-555555555555',workerId:active.workerId,displayName:active.displayName,roleLabels:active.roleLabels,skillTags:active.skillTags,active:false,expectedVersion:active.version};
const never=new Promise<never>(()=>{});

function states({showArchived=false,statusChange=null,pending=null}:{showArchived?:boolean;statusChange?:{worker:Worker;active:boolean}|null;pending?:WorkerSaveAttempt|null}={}){return['allowed',[active,archived],{workerId:null,displayName:'',roles:'',skills:'',active:true,version:0},false,false,'',true,pending,false,showArchived,statusChange];}
function text(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(text).join('');if(node&&typeof node==='object'&&'props'in node)return text((node as ReactElement<{children?:ReactNode}>).props.children);return'';}
function button(node:ReactNode,label:string):ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>{if(node&&typeof node==='object'&&'props'in node){const element=node as ReactElement<{disabled?:boolean;onClick?:()=>void;children?:ReactNode}>;if(element.type==='button'&&text(element.props.children)===label)return element;const children=element.props.children;for(const child of Array.isArray(children)?children:[children]){try{return button(child,label);}catch{/* Continue through the rendered tree. */}}}throw new Error(`Button ${label} not found`);}
function render(state:unknown[]){mocks.states=state;const tree=SchedulingModule({workspaceId,userId});return{tree,markup:renderToStaticMarkup(tree)};}

describe('Scheduling worker archive and restore controls',()=>{
 beforeEach(()=>{mocks.states=[];mocks.invoke.mockReset();mocks.invoke.mockReturnValue(never);vi.stubGlobal('window',{sessionStorage:{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()},dispatchEvent:vi.fn()});});

 it('shows active workers by default and archived workers only when requested',()=>{const hidden=render(states()).markup;expect(hidden).toContain('Active Worker');expect(hidden).not.toContain('Archived Worker');expect(hidden).toContain('Show archived workers');const shown=render(states({showArchived:true})).markup;expect(shown).toContain('Archived Worker');expect(shown).toContain('RESTORE WORKER');});

 it('confirms archive by worker name and explains history, assignment blocking and no automatic cancellation',()=>{const {markup}=render(states({statusChange:{worker:active,active:false}}));expect(markup).toContain('Archive Active Worker?');expect(markup).toContain('Their history remains.');expect(markup).toContain('Archived workers cannot receive new assignments.');expect(markup).toContain('Active assignments must be cancelled first');expect(markup).toContain('will not cancel work automatically');expect(markup).toContain('CONFIRM ARCHIVE');});

 it('confirms restore by worker name through the protected status flow',()=>{const {markup}=render(states({showArchived:true,statusChange:{worker:archived,active:true}}));expect(markup).toContain('Restore Archived Worker?');expect(markup).toContain('They will be active and can receive new assignments.');expect(markup).toContain('CONFIRM RESTORE');});

 it('pending archive blocks new controls and retries the unchanged request',()=>{const {tree,markup}=render(states({pending:pendingArchive}));expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>ADD WORKER/);expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>ARCHIVE WORKER/);const retry=button(tree,'RETRY SAME ARCHIVE');expect(retry.props.disabled).toBe(false);retry.props.onClick?.();expect(mocks.invoke).toHaveBeenCalledWith('rev-worker-save',{body:pendingArchive});});
});
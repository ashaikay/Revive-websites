// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',staff='33333333-3333-4333-8333-333333333333';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{rpc:(...args:unknown[])=>mocks.rpc(...args)}}));
vi.mock('@/components/SchedulingWeeklyPlanner',()=>({SchedulingWeeklyPlanner:()=> <p>Weekly planner</p>}));
vi.mock('@/components/SchedulingJobsPanel',()=>({SchedulingJobsPanel:({allowDocuments}:{allowDocuments:boolean})=> <p>{allowDocuments?'Owner job tools':'Scheduling job tools'}</p>}));
vi.mock('@/services/schedulingWorkers',async original=>({...await original<object>(),loadSchedulingWorkers:async()=>[],restoreWorkerAttempt:()=>null}));
vi.mock('@/services/calendarBusinessHours',()=>({loadBusinessHours:async()=>({timezone:'Europe/London'})}));
import {SchedulingManagementAccessPanel} from '@/components/SchedulingManagementAccessPanel';
import type {TeamMember} from '@/services/workspaceTeam';
import {SchedulingModule} from '@/components/SchedulingModule';
import {loadSchedulingManagement,parseSchedulingManagement,parseSchedulingPermissionAttempt} from '@/services/schedulingManagementAccess';
const row=(userId=staff,enabled=false,version=0,managed=false)=>({workspaceId:ws,userId,enabled,canManage:enabled||managed,version,managed});
const members:TeamMember[]=[{userId:staff,role:'member',status:'active',displayName:'Natalie',nameVersion:1}];
const panel=()=>render(<SchedulingManagementAccessPanel workspaceId={ws} actorId={actor} members={members} externalLocked={false} onLocked={vi.fn()}/>);
beforeEach(()=>{sessionStorage.clear();mocks.rpc.mockReset();mocks.rpc.mockImplementation(async(_name:string,args:{target_user_id:string})=>({data:row(args.target_user_id),error:null}));});
afterEach(cleanup);
it('saves only a dedicated permission using the loaded version, without promoting membership',async()=>{
 panel();fireEvent.change(screen.getByLabelText('Scheduling staff member'),{target:{value:staff}});
 fireEvent.click(await screen.findByLabelText('Manage Scheduling'));
 mocks.rpc.mockImplementation(async(_name:string,args:{target_user_id:string})=>({data:row(args.target_user_id,true,1),error:null}));
 fireEvent.click(screen.getByRole('button',{name:'Save Scheduling permission'}));await screen.findByText('Scheduling permission saved.');
 const write=mocks.rpc.mock.calls.find(([name])=>name==='save_rev_scheduling_management');
 expect(write?.[1]).toMatchObject({target_workspace_id:ws,target_user_id:staff,target_enabled:true,expected_version:0});expect(write?.[1]).not.toHaveProperty('role');
});
it('retains an exact uncertain request across refresh and clears a definitive stale refusal',async()=>{
 mocks.rpc.mockImplementation(async(name:string,args:{target_user_id:string})=>name==='get_rev_scheduling_management'?{data:row(args.target_user_id),error:null}:{data:null,error:{code:'FETCH_ERROR'}});
 const view=panel();fireEvent.change(screen.getByLabelText('Scheduling staff member'),{target:{value:staff}});fireEvent.click(await screen.findByLabelText('Manage Scheduling'));fireEvent.click(screen.getByRole('button',{name:'Save Scheduling permission'}));
 await screen.findByRole('button',{name:'Retry same Scheduling permission'});const exact=mocks.rpc.mock.calls.find(([name])=>name==='save_rev_scheduling_management')?.[1];view.unmount();
 panel();mocks.rpc.mockResolvedValue({data:null,error:{code:'40001'}});fireEvent.click(await screen.findByRole('button',{name:'Retry same Scheduling permission'}));await screen.findByText('Permission changed. Reload before saving again.');
 const writes=mocks.rpc.mock.calls.filter(([name])=>name==='save_rev_scheduling_management');expect(writes[1][1]).toEqual(exact);expect(sessionStorage.getItem(`rev-scheduling-permission:${ws}:${actor}`)).toBeNull();
});
it('fails closed on malformed retained permissions',async()=>{
 sessionStorage.setItem(`rev-scheduling-permission:${ws}:${actor}`,'broken');panel();await screen.findByText(/retained permission change could not be read/);expect(screen.getByLabelText('Scheduling staff member')).toBeDisabled();expect(mocks.rpc).not.toHaveBeenCalled();
});
it('does not show permission controls after a failed read',async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});panel();fireEvent.change(screen.getByLabelText('Scheduling staff member'),{target:{value:staff}});await screen.findByText(/Permission could not be loaded/);expect(screen.queryByRole('button',{name:'Save Scheduling permission'})).toBeNull();
});
it('does not accept response identity mismatches or invented retained actors',async()=>{
 expect(()=>parseSchedulingManagement(row(),ws,actor)).toThrow();expect(()=>parseSchedulingPermissionAttempt({workspaceId:ws,userId:staff,enabled:true,expectedVersion:0,requestId:'bad'},ws)).toThrow();
 mocks.rpc.mockResolvedValue({data:row(),error:null});await expect(loadSchedulingManagement(ws,actor)).rejects.toThrow('verified');
});
it('opens operational Scheduling for an explicitly authorised member but keeps administration absent',async()=>{
 mocks.rpc.mockResolvedValue({data:row(staff,true,1),error:null});render(<SchedulingModule workspaceId={ws} userId={staff}/>);
 expect(await screen.findByRole('button',{name:'ADD WORKER'})).toBeEnabled();expect(screen.getByText('Scheduling job tools')).toBeVisible();expect(screen.queryByRole('button',{name:'ANNUAL LEAVE'})).toBeNull();
});
it('keeps the owner annual leave and document controls',async()=>{
 mocks.rpc.mockResolvedValue({data:row(actor,false,0,true),error:null});render(<SchedulingModule workspaceId={ws} userId={actor}/>);await screen.findByRole('button',{name:'ADD WORKER'});expect(screen.getByRole('button',{name:'ANNUAL LEAVE'})).toBeVisible();expect(screen.getByText('Owner job tools')).toBeVisible();
});
it('does not open Scheduling merely because section access was granted',async()=>{
 render(<SchedulingModule workspaceId={ws} userId={staff}/>);await screen.findByText(/Ask your organisation owner to enable Scheduling manager/);expect(screen.queryByRole('button',{name:'ADD WORKER'})).toBeNull();
});
it('removes management controls after permission revocation on focus',async()=>{
 mocks.rpc.mockResolvedValue({data:row(staff,true,1),error:null});render(<SchedulingModule workspaceId={ws} userId={staff}/>);await screen.findByRole('button',{name:'ADD WORKER'});
 mocks.rpc.mockResolvedValue({data:row(staff,false,2),error:null});fireEvent(window,new Event('focus'));await screen.findByText(/Ask your organisation owner to enable Scheduling manager/);expect(screen.queryByRole('button',{name:'ADD WORKER'})).toBeNull();
});
it('preserves a pending permission and blocks repeated submissions',async()=>{
 let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
 mocks.rpc.mockImplementation(async(name:string,args:{target_user_id:string})=>name==='get_rev_scheduling_management'?{data:row(args.target_user_id),error:null}:pending);
 panel();fireEvent.change(screen.getByLabelText('Scheduling staff member'),{target:{value:staff}});await screen.findByLabelText('Manage Scheduling');const form=screen.getByRole('button',{name:'Save Scheduling permission'}).closest('form')!;fireEvent.submit(form);fireEvent.submit(form);
 await waitFor(()=>expect(mocks.rpc.mock.calls.filter(([name])=>name==='save_rev_scheduling_management')).toHaveLength(1));finish({data:row(staff,true,1),error:null});await screen.findByText('Scheduling permission saved.');
});

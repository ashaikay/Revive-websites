// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{rpc:mocks.rpc}}));
import {WorkspaceModuleGate} from '@/components/WorkspaceModuleGate';
import {WorkspaceModuleAccessPanel} from '@/components/WorkspaceModuleAccessPanel';
import {loadModuleAccess,saveModuleAccess,parseModuleAccess,accessPages,ModuleAccessRejected,type ModuleAttempt} from '@/services/workspaceModuleAccess';
const ws='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',es='33333333-3333-4333-8333-333333333333',req='44444444-4444-4444-8444-444444444444';
const row=(userId=es,modules=['programme'])=>({workspaceId:ws,userId,modules,version:1,managed:false});
beforeEach(()=>{mocks.rpc.mockReset();sessionStorage.clear();window.history.replaceState(null,'','/#programme');});
afterEach(()=>cleanup());
it('reads only the exact workspace and subject and rejects unverified responses',async()=>{
 mocks.rpc.mockResolvedValue({data:row(),error:null});await loadModuleAccess(ws,es);
 expect(mocks.rpc).toHaveBeenCalledWith('get_rev_workspace_module_access',{target_workspace_id:ws,target_user_id:es});
 expect(()=>parseModuleAccess({...row(),workspaceId:actor},ws,es)).toThrow();
 expect(()=>parseModuleAccess({...row(),modules:['invented']},ws,es)).toThrow();
 expect(()=>parseModuleAccess({...row(),modules:['programme','programme']},ws,es)).toThrow();
});
it('keeps the cross-module Home dashboard unavailable to Outcomes-only staff',()=>{
 expect(accessPages(['programme'])).toEqual(['programme']);
 expect(accessPages(['programme','rev','business','customers','growth','scheduling'])).toContain('home');
});
it('does not mount any workspace content before the access check completes',async()=>{
 let resolve!:(v:unknown)=>void;mocks.rpc.mockReturnValue(new Promise(r=>{resolve=r;}));const child=vi.fn(()=> <p>Private workspace</p>);
 render(<WorkspaceModuleGate workspaceId={ws} userId={es} page="business" onSignOut={vi.fn()}>{child}</WorkspaceModuleGate>);
 expect(child).not.toHaveBeenCalled();expect(screen.getByText('Loading your access...')).toBeVisible();
 resolve({data:row(),error:null});await screen.findByText('Private workspace');expect(child).toHaveBeenLastCalledWith(['programme'],'programme');
});
it('fails closed on an unavailable permission RPC rather than restoring broad Member access',async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{code:'PGRST202'}});const child=vi.fn(()=>null);
 render(<WorkspaceModuleGate workspaceId={ws} userId={es} page="programme" onSignOut={vi.fn()}>{child}</WorkspaceModuleGate>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Section access could not be loaded.');expect(child).not.toHaveBeenCalled();
});
it('hides module content after a failed foreground access refresh',async()=>{
 mocks.rpc.mockResolvedValue({data:row(),error:null});
 render(<WorkspaceModuleGate workspaceId={ws} userId={es} page="programme" onSignOut={vi.fn()}>{()=> <p>Case records</p>}</WorkspaceModuleGate>);
 await screen.findByText('Case records');mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});fireEvent(window,new Event('focus'));
 await screen.findByRole('alert');expect(screen.queryByText('Case records')).toBeNull();
});
it('ignores an old workspace response after context changes',async()=>{
 let resolve!:(v:unknown)=>void;mocks.rpc.mockReturnValueOnce(new Promise(r=>{resolve=r;}));
 const child=vi.fn(()=> <p>Current records</p>);const props={userId:es,page:'programme',onSignOut:vi.fn()};
 const view=render(<WorkspaceModuleGate {...props} workspaceId={ws}>{child}</WorkspaceModuleGate>);
 mocks.rpc.mockResolvedValue({data:{...row(),workspaceId:actor,modules:[]},error:null});view.rerender(<WorkspaceModuleGate {...props} workspaceId={actor}>{child}</WorkspaceModuleGate>);
 await screen.findByText(/No REV sections are enabled/);resolve({data:row(),error:null});await Promise.resolve();expect(child).not.toHaveBeenCalled();
});
it('sends no browser-selected actor or role and preserves the exact versioned access payload',async()=>{
 const attempt:ModuleAttempt={workspaceId:ws,userId:es,modules:['programme'],expectedVersion:1,requestId:req};
 mocks.rpc.mockResolvedValue({data:{...row(),version:2},error:null});await saveModuleAccess(attempt);
 expect(mocks.rpc).toHaveBeenCalledWith('save_rev_workspace_module_access',{target_workspace_id:ws,target_user_id:es,target_modules:['programme'],expected_version:1,target_request_id:req});
});
it('distinguishes a definitive conflict from unknown transport outcomes',async()=>{
 const attempt:ModuleAttempt={workspaceId:ws,userId:es,modules:['programme'],expectedVersion:1,requestId:req};
 mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'40001'}});await expect(saveModuleAccess(attempt)).rejects.toBeInstanceOf(ModuleAccessRejected);
 mocks.rpc.mockResolvedValueOnce({data:null,error:{code:'FETCH_ERROR'}});await expect(saveModuleAccess(attempt)).rejects.not.toBeInstanceOf(ModuleAccessRejected);
});
it('does not treat a mismatched successful reply as confirmed',async()=>{
 mocks.rpc.mockResolvedValue({data:{...row(es,['rev']),version:2},error:null});
 await expect(saveModuleAccess({workspaceId:ws,userId:es,modules:['programme'],expectedVersion:1,requestId:req})).rejects.toThrow('Save not confirmed');
});
it('restores an exact access retry after refresh and locks staff navigation',async()=>{
 const attempt:ModuleAttempt={workspaceId:ws,userId:es,modules:['programme'],expectedVersion:1,requestId:req};
 sessionStorage.setItem(`rev-module-attempt:${ws}:${actor}`,JSON.stringify(attempt));const lock=vi.fn();
 mocks.rpc.mockResolvedValue({data:{...row(),version:2},error:null});
 render(<WorkspaceModuleAccessPanel workspaceId={ws} actorId={actor} members={[]} onLocked={lock}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Retry same access change'}));
 expect(await screen.findByText('Section access saved.')).toBeVisible();
 expect(mocks.rpc.mock.calls[0]).toEqual(['save_rev_workspace_module_access',{target_workspace_id:ws,target_user_id:es,target_modules:['programme'],expected_version:1,target_request_id:req}]);
 await waitFor(()=>expect(lock).toHaveBeenCalledWith(false));expect(sessionStorage.getItem(`rev-module-attempt:${ws}:${actor}`)).toBeNull();
});
it('blocks writes when a retained attempt is malformed instead of discarding it',async()=>{
 sessionStorage.setItem(`rev-module-attempt:${ws}:${actor}`,'broken');const lock=vi.fn();
 render(<WorkspaceModuleAccessPanel workspaceId={ws} actorId={actor} members={[]} onLocked={lock}/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('retained access change');await waitFor(()=>expect(lock).toHaveBeenCalledWith(true));expect(mocks.rpc).not.toHaveBeenCalled();
});
it('lets a manager save an empty selection without deleting or changing membership roles',async()=>{
 mocks.rpc.mockImplementation(async(name:string)=>({data:name==='get_rev_workspace_module_access'?row():{...row(es,[]),version:2},error:null}));
 render(<WorkspaceModuleAccessPanel workspaceId={ws} actorId={actor} members={[{userId:es,role:'member',status:'active',displayName:'Jane',nameVersion:1}]} onLocked={vi.fn()}/>);
 fireEvent.change(screen.getByLabelText('Staff member'),{target:{value:es}});fireEvent.click(await screen.findByLabelText('Outcomes'));fireEvent.click(screen.getByRole('button',{name:'Save section access'}));
 await screen.findByText('Section access saved.');const call=mocks.rpc.mock.calls.find(([name])=>name==='save_rev_workspace_module_access');expect(call?.[1].target_modules).toEqual([]);expect(call?.[1]).not.toHaveProperty('role');
});

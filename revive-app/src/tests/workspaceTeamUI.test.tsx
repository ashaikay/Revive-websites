// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const ws='11111111-1111-4111-8111-111111111111', owner='22222222-2222-4222-8222-222222222222', guest='33333333-3333-4333-8333-333333333333', invite='44444444-4444-4444-8444-444444444444';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),signIn:vi.fn(),signUp:vi.fn(),signOut:vi.fn(),onChange:vi.fn()}));
vi.mock('@/data/supabaseClient',()=>({supabaseClient:{rpc:(...args:unknown[])=>mocks.rpc(...args),auth:{getUser:()=>mocks.getUser(),signInWithPassword:(...args:unknown[])=>mocks.signIn(...args),signUp:(...args:unknown[])=>mocks.signUp(...args),signOut:()=>mocks.signOut(),onAuthStateChange:(...args:unknown[])=>mocks.onChange(...args)}}}));
import {WorkspaceTeamPanel} from '@/components/WorkspaceTeamPanel';
import {WorkspaceInvitationPanel} from '@/components/WorkspaceInvitationPanel';
import {invitationFromLocation,invitationLink,parseTeamDirectory,submitTeamAttempt,TeamRejectedError} from '@/services/workspaceTeam';
const directory=()=>({workspaceId:ws,members:[{userId:owner,role:'owner',status:'active',displayName:'Mike',nameVersion:1},{userId:guest,role:'member',status:'active',displayName:'Jane',nameVersion:1}],invitations:[]});
beforeEach(()=>{
 window.sessionStorage.clear();mocks.rpc.mockReset().mockImplementation(async(name:string)=>({data:name==='list_rev_workspace_team'?directory():null,error:null}));
 mocks.getUser.mockReset().mockResolvedValue({data:{user:null},error:null});mocks.signIn.mockReset();mocks.signUp.mockReset();mocks.signOut.mockReset().mockResolvedValue({error:null});mocks.onChange.mockReset().mockReturnValue({data:{subscription:{unsubscribe:vi.fn()}}});
 vi.stubGlobal('crypto',{randomUUID:()=> '77777777-7777-4777-8777-777777777777'});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const panel=(props:Partial<React.ComponentProps<typeof WorkspaceTeamPanel>>={})=>render(<WorkspaceTeamPanel workspaceId={ws} userId={owner} onChanged={vi.fn(async()=>{})} onLocked={vi.fn()} {...props}/>);

describe('manager staff invitations',()=>{
 it('creates a private invitation link without emailing or activating membership',async()=>{
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==='list_rev_workspace_team'?directory():{operation:'invite',workspaceId:ws,invitationId:invite},error:null}));
  panel();fireEvent.change(await screen.findByLabelText('Staff name'),{target:{value:'Jane Smith'}});fireEvent.change(screen.getByLabelText('Staff email'),{target:{value:' Jane@example.test '}});
  // HTML email validation handles whitespace; submit via form to exercise the trusted normalisation contract.
  fireEvent.submit(screen.getByRole('button',{name:'Create invitation link'}).closest('form')!);
  expect((await screen.findByLabelText('Invitation link') as HTMLInputElement).value).toContain(`rev_team_invite=${invite}`);
  expect(mocks.rpc.mock.calls.find(([name])=>name==='manage_rev_workspace_team')?.[1]).toMatchObject({target_operation:'invite',target_payload:{displayName:'Jane Smith',email:'jane@example.test'}});
  expect(mocks.signUp).not.toHaveBeenCalled();expect(mocks.signIn).not.toHaveBeenCalled();
 });
 it('retains exact uncertain requests across remount and clears definitive permission refusals',async()=>{
  const locked=vi.fn();let reject=false;
  mocks.rpc.mockImplementation(async(name:string)=>name==='list_rev_workspace_team'?{data:directory(),error:null}:{data:null,error:{code:reject?'42501':'FETCH_ERROR'}});
  const first=panel({onLocked:locked});fireEvent.change(await screen.findByLabelText('Staff name'),{target:{value:'Jane'}});fireEvent.change(screen.getByLabelText('Staff email'),{target:{value:'jane@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Create invitation link'}));
  await screen.findByRole('button',{name:'Retry same team change'});const original=mocks.rpc.mock.calls.find(([name])=>name==='manage_rev_workspace_team')?.[1];first.unmount();
  panel();reject=true;fireEvent.click(await screen.findByRole('button',{name:'Retry same team change'}));
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('not permitted'));
  const writes=mocks.rpc.mock.calls.filter(([name])=>name==='manage_rev_workspace_team');expect(writes[1][1]).toEqual(original);
  expect(window.sessionStorage.getItem(`rev-team-attempt:${ws}:${owner}`)).toBeNull();expect(screen.queryByRole('button',{name:'Retry same team change'})).toBeNull();
 });
 it('requires explicit confirmation for staff suspension and protects owner controls',async()=>{
  panel();const accounts=await screen.findByLabelText('Staff accounts');const jane=within(accounts).getByText('Jane').closest('li')!,mike=within(accounts).getByText('Mike').closest('li')!;
  expect(within(mike).queryByRole('button',{name:'Suspend access'})).toBeNull();fireEvent.click(within(jane).getByRole('button',{name:'Suspend access'}));
  expect(mocks.rpc.mock.calls.filter(([name])=>name==='manage_rev_workspace_team')).toHaveLength(0);
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==='list_rev_workspace_team'?directory():{operation:'suspend',workspaceId:ws,userId:guest},error:null}));
  fireEvent.click(within(jane).getByRole('button',{name:'Confirm suspension'}));expect(await screen.findByText('Staff access suspended.')).toBeVisible();
  expect(mocks.rpc.mock.calls.find(([name])=>name==='manage_rev_workspace_team')?.[1]).toMatchObject({target_payload:{userId:guest,expectedStatus:'active'}});
 });
 it('saves names using the loaded version and never changes a staff role',async()=>{
  panel();const mike=(await screen.findByText('Mike')).closest('li')!;fireEvent.click(within(mike).getByRole('button',{name:'Edit team name'}));fireEvent.change(within(mike).getByLabelText('Name shown in team'),{target:{value:'Michael Blackwood'}});
  mocks.rpc.mockImplementation(async(name:string)=>({data:name==='list_rev_workspace_team'?directory():{operation:'rename',workspaceId:ws,userId:owner},error:null}));
  fireEvent.click(within(mike).getByRole('button',{name:'Save team name'}));expect(await screen.findByText('Team name saved.')).toBeVisible();
  expect(mocks.rpc.mock.calls.find(([name])=>name==='manage_rev_workspace_team')?.[1]).toMatchObject({target_operation:'rename',target_payload:{userId:owner,displayName:'Michael Blackwood',expectedVersion:1}});
 });
 it('does not offer an invitation form after a denied directory read',async()=>{
  mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});panel();expect(await screen.findByRole('alert')).toHaveTextContent('Team setup is unavailable');expect(screen.queryByLabelText('Staff email')).toBeNull();
 });
});

describe('identity-bound acceptance',()=>{
 it('accepts as the signed-in account without a client-selected workspace or role',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:guest,email:'jane@example.test'}},error:null});mocks.rpc.mockResolvedValue({data:{workspaceId:ws,role:'member',accepted:true},error:null});const done=vi.fn();
  render(<WorkspaceInvitationPanel invitationId={invite} onAccepted={done}/>);fireEvent.click(await screen.findByRole('button',{name:'Accept invitation'}));await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
  expect(mocks.rpc).toHaveBeenCalledWith('accept_rev_workspace_invitation',{target_invitation_id:invite});
 });
 it('keeps a denied or expired acceptance on the invitation page',async()=>{
  mocks.getUser.mockResolvedValue({data:{user:{id:guest,email:'wrong@example.test'}},error:null});mocks.rpc.mockResolvedValue({data:null,error:{code:'42501'}});const done=vi.fn();render(<WorkspaceInvitationPanel invitationId={invite} onAccepted={done}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Accept invitation'}));expect(await screen.findByRole('alert')).toHaveTextContent('invited account');expect(done).not.toHaveBeenCalled();
 });
 it('offers account creation with a same-origin verification return link and keeps passwords out of storage',async()=>{
  mocks.signUp.mockResolvedValue({data:{session:null},error:null});render(<WorkspaceInvitationPanel invitationId={invite} onAccepted={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Create account'}));fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'jane@example.test'}});fireEvent.change(screen.getByLabelText('Password'),{target:{value:'A-strong-private-password'}});fireEvent.click(screen.getByRole('button',{name:'Create my account'}));
  expect(await screen.findByText(/The account request was received/)).toBeVisible();expect(screen.getByLabelText('Password')).toHaveValue('');expect(window.sessionStorage.length).toBe(0);expect(mocks.rpc).not.toHaveBeenCalled();
  const redirect=new URL(mocks.signUp.mock.calls[0][0].options.emailRedirectTo);expect(redirect.origin).toBe(window.location.origin);expect(redirect.searchParams.get('rev_team_invite')).toBe(invite);
 });

 it('does not claim confirmation was sent for an existing or indistinguishable account',async()=>{
  mocks.signUp.mockResolvedValue({data:{session:null,user:{id:guest,email:'jane@example.test',identities:[]}},error:null});
  render(<WorkspaceInvitationPanel invitationId={invite} onAccepted={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Create account'}));
  fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'jane@example.test'}});
  fireEvent.change(screen.getByLabelText('Password'),{target:{value:'A-strong-private-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Create my account'}));
  expect(await screen.findByText(/confirmation email is not guaranteed/)).toHaveTextContent('choose Sign in');
  expect(screen.getByRole('button',{name:'Forgot or need a password?'})).toBeVisible();
  expect(mocks.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Sign in'}));
  expect(screen.getByRole('button',{name:'Sign in to continue'})).toBeVisible();
 });
 it('offers acceptance when signup returns a session without automatically joining',async()=>{
  mocks.signUp.mockResolvedValue({data:{session:{user:{id:guest}},user:{id:guest,email:'jane@example.test'}},error:null});
  const done=vi.fn();render(<WorkspaceInvitationPanel invitationId={invite} onAccepted={done}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Create account'}));
  fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'jane@example.test'}});
  fireEvent.change(screen.getByLabelText('Password'),{target:{value:'A-strong-private-password'}});
  fireEvent.click(screen.getByRole('button',{name:'Create my account'}));
  expect(await screen.findByRole('button',{name:'Accept invitation'})).toBeVisible();
  expect(screen.getByText(/You are signed in. Accept the invitation/)).toBeVisible();
  expect(done).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('rejects malformed links and hostile redirect origins',()=>{
  expect(invitationFromLocation('?rev_team_invite=bad')).toBe('invalid');expect(invitationFromLocation(`?rev_team_invite=${invite}&rev_team_invite=${invite}`)).toBe('invalid');expect(()=>invitationLink(invite,{origin:'http://example.test',pathname:'/'})).toThrow();
  render(<WorkspaceInvitationPanel invitationId="invalid" onAccepted={vi.fn()}/>);expect(screen.getByRole('heading',{name:'Invitation unavailable'})).toBeVisible();
 });
});

describe('untrusted team responses',()=>{
 it('refuses a foreign directory and classifies authority errors without exposing server details',async()=>{
  expect(()=>parseTeamDirectory({...directory(),workspaceId:guest},ws)).toThrow();mocks.rpc.mockResolvedValue({data:null,error:{code:'42501',message:'PRIVATE SQL MESSAGE'}});
  await expect(submitTeamAttempt({workspaceId:ws,operation:'invite',requestId:invite,payload:{displayName:'Jane',email:'jane@example.test'}})).rejects.toBeInstanceOf(TeamRejectedError);
 });
});

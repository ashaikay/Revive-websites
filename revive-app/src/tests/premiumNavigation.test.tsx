// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Navigation } from '@/components/Navigation';
const mocks = vi.hoisted(() => ({ switchWorkspace:vi.fn(), mediaChange: null as null | (()=>void), media:{matches:false} }));
vi.mock('@/data/provider',()=>({dataProviderMode:'supabase'}));
vi.mock('@/hooks/useAppStore',()=>({useAppStore:()=>({currentWorkspaceId:'first',switchWorkspace:mocks.switchWorkspace,workspaces:[{id:'first',name:'First workspace'},{id:'second',name:'Second workspace'}],currentUser:{id:'staff',displayName:'Robert Example',email:'robert@example.invalid'}})}));
beforeEach(()=>{
  window.history.replaceState(null,'','/#programme'); mocks.switchWorkspace.mockReset(); mocks.media.matches=false;
  vi.stubGlobal('matchMedia',()=>({get matches(){return mocks.media.matches;},addEventListener:(_type:string,fn:()=>void)=>{mocks.mediaChange=fn;},removeEventListener:vi.fn()}));
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.setAttribute('open','');}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.removeAttribute('open');}});
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it('shows only permitted destinations, the real identity and no fabricated approvals',()=>{
 render(<Navigation allowedPages={['programme','scheduling']} onSignOut={vi.fn()}/>);
 const nav=screen.getByRole('navigation',{name:'Primary'});
 expect(within(nav).getByRole('button',{name:'Outcomes'})).toHaveAttribute('aria-current','page');
 expect(within(nav).queryByRole('button',{name:'Overview'})).not.toBeInTheDocument();
 expect(within(nav).queryByRole('button',{name:'Business'})).not.toBeInTheDocument();
 expect(screen.getAllByText('Robert Example').length).toBeGreaterThan(0);
 expect(screen.getAllByText('robert@example.invalid').length).toBeGreaterThan(0);
 expect(screen.queryByLabelText(/approvals waiting/)).not.toBeInTheDocument();
});
it('uses the gated destination for active navigation and preserves hash routing',()=>{
 render(<Navigation activePage="programme" allowedPages={['programme','scheduling']}/>);
 const nav=screen.getByRole('navigation',{name:'Primary'});
 fireEvent.click(within(nav).getByRole('button',{name:'Scheduling'}));
 expect(window.location.hash).toBe('#scheduling');
 expect(within(nav).getByRole('button',{name:'Outcomes'})).toHaveAttribute('aria-current','page');
});
it('switches workspaces through the existing callback and signs out through the supplied callback',()=>{
 const signOut=vi.fn();render(<Navigation onSignOut={signOut}/>);
 fireEvent.change(screen.getByLabelText('Current workspace',{selector:'#workspace-switcher'}),{target:{value:'second'}});
 expect(mocks.switchWorkspace).toHaveBeenCalledWith('second');
 fireEvent.click(screen.getAllByRole('button',{name:'Sign out'})[0]);expect(signOut).toHaveBeenCalledTimes(1);
});
it('opens a modal mobile menu, focuses close, navigates and restores focus',()=>{
 render(<Navigation allowedPages={['programme','scheduling']}/>);
 const menu=screen.getByRole('button',{name:'Open navigation'});fireEvent.click(menu);
 const dialog=screen.getByRole('dialog',{name:'Workspace navigation'});
 expect(within(dialog).getByRole('button',{name:'Close navigation'})).toHaveFocus();
 expect(menu).toHaveAttribute('aria-expanded','true');expect(document.body.style.overflow).toBe('hidden');
 fireEvent.click(within(dialog).getByRole('button',{name:'Scheduling'}));
 expect(window.location.hash).toBe('#scheduling');expect(menu).toHaveFocus();expect(menu).toHaveAttribute('aria-expanded','false');
 expect(document.body.style.overflow).toBe('');
});
it('closes the drawer on Escape cancellation and desktop resize',()=>{
 render(<Navigation/>);const menu=screen.getByRole('button',{name:'Open navigation'});
 fireEvent.click(menu);fireEvent(screen.getByRole('dialog'),new Event('cancel',{bubbles:true}));
 expect(menu).toHaveAttribute('aria-expanded','false');
 fireEvent.click(menu);act(()=>{mocks.media.matches=true;mocks.mediaChange?.();});
 expect(menu).toHaveAttribute('aria-expanded','false');expect(document.body.style.overflow).toBe('');
});
it('cleans up scroll lock when the shell unmounts and supports skip-to-content without changing routes',()=>{
 const view=render(<><Navigation/><main id="rev-main-content" tabIndex={-1}>Content</main></>);
 fireEvent.click(screen.getByText('Skip to content'));expect(screen.getByText('Content')).toHaveFocus();expect(window.location.hash).toBe('#programme');
 fireEvent.click(screen.getByRole('button',{name:'Open navigation'}));view.unmount();expect(document.body.style.overflow).toBe('');
});

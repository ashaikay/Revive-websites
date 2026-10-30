import '@/styles/rev-premium-navigation.css';
import React from 'react';
import { useAppStore } from '@/hooks/useAppStore';
import { WorkspaceService } from '@/services/workspaceService';
import { dataProviderMode } from '@/data/provider';

const navItems = [
  { label: 'Overview', id: 'home', symbol: 'grid' },
  { label: 'REV', id: 'rev', symbol: 'spark' },
  { label: 'Customers', id: 'customers', symbol: 'people' },
  { label: 'Outcomes', id: 'programme', symbol: 'target' },
  { label: 'Scheduling', id: 'scheduling', symbol: 'calendar' },
  { label: 'Growth', id: 'growth', symbol: 'growth' },
  { label: 'Business', id: 'business', symbol: 'business' },
];

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    spark: <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5.65" /></>,
    target: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" /></>,
    growth: <><path d="M3 17 9 11l4 4L21 5M15 5h6v6M3 21h18" /></>,
    business: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V3h8v4M3 13h18M10 13v3h4v-3" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export const Navigation: React.FC<{ onSignOut?: () => void; allowedPages?: string[]; activePage?: string; accountName?: string; accountEmail?: string }> = ({ onSignOut, allowedPages, activePage, accountName, accountEmail }) => {
  const { currentWorkspaceId, switchWorkspace, workspaces, currentUser } = useAppStore();
  const [hashPage, setHashPage] = React.useState(() => window.location.hash.slice(1) || 'home');
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const menuButton = React.useRef<HTMLButtonElement>(null);
  const closeButton = React.useRef<HTMLButtonElement>(null);
  const page = activePage ?? hashPage;
  const items = navItems.filter(item => !allowedPages || allowedPages.includes(item.id));
  const title = items.find(item => item.id === page)?.label ?? 'Workspace';
  const name = accountName?.trim() || currentUser.displayName?.trim() || 'Your account';
  const email = accountEmail ?? currentUser.email;
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const workspace = workspaces.find(item => item.id === currentWorkspaceId)?.name ?? 'Workspace';
  const pendingCount = dataProviderMode === 'supabase' ? 0 : (WorkspaceService.getWorkspaceData(currentWorkspaceId).approvals ?? []).filter(item => item.status === 'pending').length;

  React.useEffect(() => {
    const update = () => { setHashPage(window.location.hash.slice(1) || 'home'); setMobileOpen(false); };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  React.useEffect(() => { setMobileOpen(false); }, [currentWorkspaceId, currentUser.id]);
  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(min-width: 960px)');
    const resize = () => { if (media.matches) setMobileOpen(false); };
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);
  React.useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (mobileOpen) {
      element.showModal();
      closeButton.current?.focus();
      const overflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = overflow; element.close(); menuButton.current?.focus(); };
    }
  }, [mobileOpen]);

  const navigate = (id: string) => { window.location.hash = id === 'home' ? '' : id; setMobileOpen(false); };
  const contents = (mobile: boolean) => <>
    <div className="rev-shell-brand"><span className="rev-shell-mark" aria-hidden="true">R</span><div><strong>REV</strong><span>Business Hub</span></div>{mobile && <button ref={closeButton} type="button" className="rev-shell-icon-button" aria-label="Close navigation" onClick={() => setMobileOpen(false)}>×</button>}</div>
    <div className="rev-shell-workspace"><label htmlFor={mobile ? 'mobile-workspace-switcher' : 'workspace-switcher'}>Current workspace</label><select id={mobile ? 'mobile-workspace-switcher' : 'workspace-switcher'} value={currentWorkspaceId} onChange={event => { switchWorkspace(event.target.value); setMobileOpen(false); }}>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    <nav aria-label={mobile ? 'Mobile primary' : 'Primary'} className="rev-shell-nav"><p className="rev-shell-section-label">Workspace</p>{items.map(item => <button key={item.id} type="button" aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><NavIcon name={item.symbol} /><span>{item.label}</span>{item.id === 'rev' && pendingCount > 0 && <span className="rev-shell-count" aria-label={`${pendingCount} approvals waiting`}>{pendingCount}</span>}</button>)}</nav>
    <div className="rev-shell-account"><span className="rev-shell-avatar" aria-hidden="true">{initials}</span><div><strong>{name}</strong><span>{email}</span></div>{onSignOut ? <button type="button" onClick={() => { setMobileOpen(false); onSignOut(); }}>Sign out</button> : <span className="rev-shell-demo">Demo workspace</span>}</div>
  </>;
  return <>
    <a className="rev-shell-skip" href="#rev-main-content" onClick={event => { event.preventDefault(); document.getElementById('rev-main-content')?.focus(); }}>Skip to content</a>
    <aside className="rev-shell-sidebar">{contents(false)}</aside>
    <header className="rev-shell-topbar"><div className="rev-shell-location"><button ref={menuButton} type="button" className="rev-shell-menu-button" aria-label="Open navigation" aria-expanded={mobileOpen} aria-controls="rev-mobile-navigation" onClick={() => setMobileOpen(true)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button><span className="rev-shell-product">REV Business Hub</span><span aria-hidden="true" className="rev-shell-divider">/</span><strong>{title}</strong></div><span className="rev-shell-context" title={workspace}>{workspace}</span></header>
    <dialog id="rev-mobile-navigation" ref={dialog} className="rev-shell-drawer" aria-label="Workspace navigation" onCancel={() => setMobileOpen(false)} onClick={event => { if (event.target === event.currentTarget) setMobileOpen(false); }}><div className="rev-shell-drawer-content">{contents(true)}</div></dialog>
  </>;
};

import React from 'react';
import { useAppStore } from '@/hooks/useAppStore';
import { WorkspaceService } from '@/services/workspaceService';
import { dataProviderMode } from '@/data/provider';

export const Navigation: React.FC<{ onSignOut?: () => void }> = ({ onSignOut }) => {
  const { currentWorkspaceId, switchWorkspace, workspaces } = useAppStore();
  const [currentPage, setCurrentPage] = React.useState<string>(() => window.location.hash.slice(1) || 'home');

  React.useEffect(() => {
    const handleHashChange = () => setCurrentPage(window.location.hash.slice(1) || 'home');
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const pendingApprovalCount =
    dataProviderMode === 'supabase'
      ? 0
      : (WorkspaceService.getWorkspaceData(currentWorkspaceId).approvals ?? []).filter((a) => a.status === 'pending').length;

  const navItems = [
    { label: 'HOME', href: '/', id: 'home' },
    { label: 'REV', href: '#rev', id: 'rev' },
    { label: 'CUSTOMERS', href: '#customers', id: 'customers' },
    { label: 'GROWTH', href: '#growth', id: 'growth' },
    { label: 'BUSINESS', href: '#business', id: 'business' },
  ];

  const handleNavClick = (href: string) => {
    // In a real app, this would be a router
    window.location.hash = href === '/' ? '' : href;
  };

  return (
    <nav className="bg-white border-b border-neutral-200" aria-label="Primary">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap justify-between items-center min-h-16 py-3 gap-3">
          {/* Logo */}
          <div className="flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold" aria-hidden="true">
                R
              </div>
              <span className="font-bold text-xl text-neutral-900">REV</span>
            </div>
          </div>

          {/* Navigation Items */}
          <div className="order-3 flex w-full gap-1 overflow-x-auto pb-1 sm:order-none sm:w-auto sm:pb-0">
            {navItems.map((item) => {
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item.href)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative min-w-[4.5rem] shrink-0 rounded-md px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-neutral-600 hover:text-primary-600 hover:bg-neutral-50'
                  }`}
                >
                  {item.label}
                  {item.id === 'rev' && pendingApprovalCount > 0 && (
                    <span
                      className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1 text-xs font-semibold text-white"
                      aria-label={`${pendingApprovalCount} approvals waiting`}
                    >
                      {pendingApprovalCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Workspace + account */}
          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor="workspace-switcher">
              Current workspace
            </label>
            <select
              id="workspace-switcher"
              value={currentWorkspaceId}
              onChange={(e) => switchWorkspace(e.target.value)}
              className="max-w-[10rem] truncate rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 cursor-pointer"
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>

            {onSignOut ? (
              <button
                onClick={onSignOut}
                className="px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                Sign out
              </button>
            ) : (
              <button
                aria-label="Account menu"
                className="px-3 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                👤
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

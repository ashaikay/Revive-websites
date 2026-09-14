import { create } from 'zustand';
import { Workspace, User } from '@/types';
import { mockCurrentUser, mockWorkspaces } from '@/data/mockData';

interface AppState {
  currentUser: User;
  currentWorkspaceId: string;
  workspaces: Workspace[];
  isInitializing: boolean;
  initializationError: string | null;
  
  // Actions
  setCurrentWorkspace: (workspaceId: string) => void;
  switchWorkspace: (workspaceId: string) => void;
  setLiveContext: (context: { user: User; workspaces: Workspace[] }) => void;
  setInitialization: (isInitializing: boolean, error?: string | null) => void;
  clearTenantState: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentUser: mockCurrentUser,
  currentWorkspaceId: mockWorkspaces[0].id, // Default to first workspace
  workspaces: mockWorkspaces,
  isInitializing: false,
  initializationError: null,
  
  setCurrentWorkspace: (workspaceId: string) =>
    set({ currentWorkspaceId: workspaceId }),
  
  switchWorkspace: (workspaceId: string) => {
    set((state) => state.workspaces.some((workspace) => workspace.id === workspaceId)
      ? { currentWorkspaceId: workspaceId }
      : state);
  },
  setLiveContext: ({ user, workspaces }) => set({
    currentUser: user,
    workspaces,
    currentWorkspaceId: workspaces[0]?.id ?? '',
    isInitializing: false,
    initializationError: null,
  }),
  setInitialization: (isInitializing, error = null) => set({ isInitializing, initializationError: error }),
  clearTenantState: () => set({ currentWorkspaceId: '', workspaces: [] }),
}));

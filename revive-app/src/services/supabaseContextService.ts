import { supabaseReadProvider } from '@/data/supabaseProvider';
import { WorkspaceRecord } from '@/domain/models';
import { User } from '@/types';

export interface LiveWorkspaceContext {
  user: User;
  workspaces: ReturnType<typeof toUiWorkspace>[];
}

function toUiWorkspace(workspace: WorkspaceRecord) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    ownerId: '',
    status: workspace.status,
    subscriptionTier: 'professional' as const,
    monthlyActionQuota: 500,
    createdAt: new Date(workspace.createdAt),
    updatedAt: new Date(workspace.updatedAt),
  };
}

export async function loadLiveWorkspaceContext(userId: string, email: string): Promise<LiveWorkspaceContext> {
  const workspaces = await supabaseReadProvider.listAuthorizedWorkspaces(userId);
  return {
    user: {
      id: userId,
      email,
      displayName: email.split('@')[0] || 'REV user',
      createdAt: new Date(),
    },
    workspaces: workspaces.map(toUiWorkspace),
  };
}

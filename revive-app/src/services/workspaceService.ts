import { getWorkspaceData } from '@/data/mockData';
import { dataProvider } from '@/data/provider';

/**
 * Workspace Service - Mock Data Provider
 * This is abstracted as a service so real providers can be swapped in later
 */
export class WorkspaceService {
  static getDataProvider() {
    return dataProvider;
  }

  /**
   * Get all data for a specific workspace
  * Compatibility view for the existing Phase 2A screens.
  * Formal Phase 2B repositories are exposed through getDataProvider().
   */
  static getWorkspaceData(workspaceId: string) {
    return getWorkspaceData(workspaceId);
  }

  /**
   * Verify user belongs to workspace
  * Phase 2B: Mock repository membership check.
  * Future: Supabase RLS remains the final database-layer control.
   */
  static verifyWorkspaceMembership(userId: string, workspaceId: string): boolean {
    return Boolean(dataProvider.workspaces.getMembership(workspaceId, userId));
  }

  /**
   * Get user's workspaces
  * Phase 2B: Return only active mock memberships.
  * Future: Query workspace_members + workspaces with RLS.
   */
  static getUserWorkspaces(userId: string) {
    return dataProvider.workspaces.listForUser(userId);
  }
}

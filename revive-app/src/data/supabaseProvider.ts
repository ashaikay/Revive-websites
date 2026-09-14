import { supabaseClient } from './supabaseClient';
import { BusinessProfileRecord, BusinessServiceRecord, WorkspaceMemberRecord, WorkspaceRecord } from '@/domain/models';

export interface SupabaseReadProvider {
  listAuthorizedWorkspaces(userId: string): Promise<WorkspaceRecord[]>;
  getMembership(workspaceId: string, userId: string): Promise<WorkspaceMemberRecord | undefined>;
  getBusinessProfile(workspaceId: string): Promise<BusinessProfileRecord | undefined>;
  listBusinessServices(workspaceId: string): Promise<BusinessServiceRecord[]>;
}

function requireClient() {
  if (!supabaseClient) throw new Error('Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY');
  return supabaseClient;
}

function mapWorkspace(row: Record<string, unknown>): WorkspaceRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    status: row.status as WorkspaceRecord['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapMembership(row: Record<string, unknown>): WorkspaceMemberRecord {
  return {
    workspaceId: String(row.workspace_id),
    userId: String(row.user_id),
    role: row.role as WorkspaceMemberRecord['role'],
    status: row.status as WorkspaceMemberRecord['status'],
    joinedAt: String(row.joined_at),
  };
}

function mapProfile(row: Record<string, unknown>): BusinessProfileRecord {
  return {
    workspaceId: String(row.workspace_id),
    businessName: String(row.business_name),
    description: String(row.description ?? ''),
    website: row.website ? String(row.website) : undefined,
    industry: row.industry ? String(row.industry) : undefined,
    targetCustomers: String(row.target_customers ?? ''),
    serviceAreas: Array.isArray(row.service_areas) ? row.service_areas.map(String) : [],
    openingHours: typeof row.opening_hours === 'object' && row.opening_hours ? row.opening_hours as Record<string, string> : {},
    differentiators: Array.isArray(row.differentiators) ? row.differentiators.map(String) : [],
    brandVoice: String(row.brand_voice ?? ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapService(row: Record<string, unknown>): BusinessServiceRecord {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    priceInformation: row.price_information ? String(row.price_information) : undefined,
    active: Boolean(row.active),
  };
}

export const supabaseReadProvider: SupabaseReadProvider = {
  async listAuthorizedWorkspaces(userId) {
    const client = requireClient();
    const { data: memberships, error: membershipError } = await client
      .from('workspace_members')
      .select('workspace_id, user_id, role, status, joined_at')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (membershipError) throw membershipError;
    const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
    if (workspaceIds.length === 0) return [];
    const { data, error } = await client
      .from('workspaces')
      .select('id, name, slug, status, created_at, updated_at')
      .in('id', workspaceIds)
      .order('name');
    if (error) throw error;
    return (data ?? []).map(mapWorkspace);
  },

  async getMembership(workspaceId, userId) {
    const client = requireClient();
    const { data, error } = await client
      .from('workspace_members')
      .select('workspace_id, user_id, role, status, joined_at')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw error;
    return data ? mapMembership(data) : undefined;
  },

  async getBusinessProfile(workspaceId) {
    const client = requireClient();
    const { data, error } = await client
      .from('business_profiles')
      .select('workspace_id, business_name, description, website, industry, target_customers, service_areas, opening_hours, differentiators, brand_voice, created_at, updated_at')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapProfile(data) : undefined;
  },

  async listBusinessServices(workspaceId) {
    const client = requireClient();
    const { data, error } = await client
      .from('business_services')
      .select('id, workspace_id, name, description, price_information, active')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('name');
    if (error) throw error;
    return (data ?? []).map(mapService);
  },
};

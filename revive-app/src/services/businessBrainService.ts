import { BusinessProfileRecord, BusinessServiceRecord } from '@/domain/models';
import { supabaseReadProvider } from '@/data/supabaseProvider';

export interface BusinessBrainRead {
  profile?: BusinessProfileRecord;
  services: BusinessServiceRecord[];
}

export async function loadBusinessBrain(workspaceId: string): Promise<BusinessBrainRead> {
  if (!workspaceId) return { services: [] };
  const [profile, services] = await Promise.all([
    supabaseReadProvider.getBusinessProfile(workspaceId),
    supabaseReadProvider.listBusinessServices(workspaceId),
  ]);
  return { profile, services };
}

import { DataProvider } from '@/domain/repositories';
import { ActorType } from '@/domain/models';

export function recordAudit(
  provider: DataProvider,
  input: {
    workspaceId: string;
    actorUserId?: string;
    actorType: ActorType;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  return provider.audit.save({
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    actorType: input.actorType,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata || {},
    timestamp: new Date().toISOString(),
  });
}

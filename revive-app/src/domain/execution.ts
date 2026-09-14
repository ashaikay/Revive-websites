import { Id, REVActionRecord } from './models';
import { CommercialRoute } from './commercialIntelligence';

export type CapabilityRiskClass = 'read_only' | 'prepare_only' | 'internal_write' | 'external_communication' | 'financial' | 'high_risk';
export type AutonomyMode = 'always_ask' | 'trusted_routine_actions' | 'ask_above_threshold' | 'disabled';
export type ExecutionPolicyDecision = 'eligible_for_dry_run' | 'blocked' | 'requires_review' | 'requires_fresh_approval' | 'requires_provider' | 'requires_configuration' | 'blocked_by_cost' | 'not_supported';
export type ExecutionPlanStatus = 'ready_for_dry_run' | 'execution_blocked';

export interface CapabilityDefinition {
  name: string;
  description: string;
  riskClass: CapabilityRiskClass;
  externalSideEffect: boolean;
  requiresApproval: boolean;
  requiresProvider: boolean;
  costClass: 'none' | 'governed';
  allowedAutonomy: AutonomyMode[];
  jurisdictionSensitive: boolean;
  audienceSafetySensitive: boolean;
  enabled: boolean;
}

export interface ExecutionContext {
  jobId: Id;
  workspaceId: Id;
  actionId: Id;
  goalId?: Id;
  recommendationId?: Id;
  commercialRoute?: CommercialRoute;
  capability: string;
  actorUserId: Id;
  approvalId?: Id;
  approvalState: string;
  provider?: string;
  countryCode?: string;
  jurisdiction?: string;
  estimatedCost: number;
  riskLevel: CapabilityRiskClass;
  autonomyMode: AutonomyMode;
  correlationId: Id;
  createdAt: string;
}

export interface ExecutionPolicyInput {
  action: REVActionRecord;
  capability: string;
  actorUserId: Id;
  workspaceId: Id;
  approvalId?: Id;
  approvalState: 'pending' | 'approved' | 'rejected';
  audienceSafety?: 'allowed' | 'review_required' | 'prohibited';
  estimatedExternalCost: number;
  providerConfigured: boolean;
  countryCode?: string;
  jurisdiction?: string;
  autonomyMode?: AutonomyMode;
  workspaceExecutionEnabled?: boolean;
}

export interface ExecutionPolicyResult {
  decision: ExecutionPolicyDecision;
  reasons: string[];
  capability: CapabilityDefinition;
  context: ExecutionContext;
}

export interface DryRunExecutionPlan {
  status: ExecutionPlanStatus;
  decision: ExecutionPolicyDecision;
  capability: string;
  externalProvider?: string;
  externalCommunication: boolean;
  estimatedExternalCost: number;
  targetWorkspaceId: Id;
  actionId: Id;
  expectedSideEffects: string[];
  reasons: string[];
  executionEnabled: false;
}

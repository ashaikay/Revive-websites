import { REVActionRecord } from '@/domain/models';
import {
  CapabilityDefinition,
  DryRunExecutionPlan,
  ExecutionContext,
  ExecutionPolicyInput,
  ExecutionPolicyResult,
} from '@/domain/execution';
import { CostGovernor } from './discoveryFoundationService';

export const PLATFORM_EXECUTION_ENABLED = false;

const CAPABILITIES: CapabilityDefinition[] = [
  { name: 'PREPARE_FOLLOW_UP', description: 'Prepare internal follow-up content for review.', riskClass: 'prepare_only', externalSideEffect: false, requiresApproval: true, requiresProvider: false, costClass: 'none', allowedAutonomy: ['always_ask'], jurisdictionSensitive: false, audienceSafetySensitive: true, enabled: true },
  { name: 'RESEARCH_PROSPECTS', description: 'Prepare an internal prospect research task.', riskClass: 'read_only', externalSideEffect: false, requiresApproval: true, requiresProvider: true, costClass: 'governed', allowedAutonomy: ['always_ask'], jurisdictionSensitive: true, audienceSafetySensitive: true, enabled: true },
  { name: 'RESEARCH_PARTNERSHIPS', description: 'Prepare an internal partnership research task.', riskClass: 'read_only', externalSideEffect: false, requiresApproval: true, requiresProvider: true, costClass: 'governed', allowedAutonomy: ['always_ask'], jurisdictionSensitive: true, audienceSafetySensitive: true, enabled: true },
  { name: 'SEND_EMAIL', description: 'Send an email to an external recipient.', riskClass: 'external_communication', externalSideEffect: true, requiresApproval: true, requiresProvider: true, costClass: 'governed', allowedAutonomy: [], jurisdictionSensitive: true, audienceSafetySensitive: true, enabled: false },
  { name: 'SEND_SMS', description: 'Send an SMS to an external recipient.', riskClass: 'external_communication', externalSideEffect: true, requiresApproval: true, requiresProvider: true, costClass: 'governed', allowedAutonomy: [], jurisdictionSensitive: true, audienceSafetySensitive: true, enabled: false },
  { name: 'FINANCIAL_ACTION', description: 'Create or change a financial commitment.', riskClass: 'financial', externalSideEffect: true, requiresApproval: true, requiresProvider: true, costClass: 'governed', allowedAutonomy: [], jurisdictionSensitive: true, audienceSafetySensitive: false, enabled: false },
  { name: 'HIGH_RISK_ACTION', description: 'Perform an action requiring elevated review.', riskClass: 'high_risk', externalSideEffect: true, requiresApproval: true, requiresProvider: true, costClass: 'governed', allowedAutonomy: [], jurisdictionSensitive: true, audienceSafetySensitive: true, enabled: false },
  { name: 'VERIFY_BUSINESS', description: 'Verify a business identity using an approved provider.', riskClass: 'read_only', externalSideEffect: false, requiresApproval: false, requiresProvider: true, costClass: 'governed', allowedAutonomy: ['always_ask'], jurisdictionSensitive: true, audienceSafetySensitive: false, enabled: true },
];

export function listCapabilities(): CapabilityDefinition[] { return CAPABILITIES.map((capability) => ({ ...capability, allowedAutonomy: [...capability.allowedAutonomy] })); }

export function getCapability(name: string): CapabilityDefinition {
  const capability = CAPABILITIES.find((item) => item.name === name);
  if (!capability) throw new Error(`Unknown execution capability: ${name}`);
  return capability;
}

function createContext(input: ExecutionPolicyInput, capability: CapabilityDefinition): ExecutionContext {
  const now = new Date().toISOString();
  return {
    jobId: `job-${input.action.id}`,
    workspaceId: input.workspaceId,
    actionId: input.action.id,
    goalId: input.action.goalId,
    recommendationId: input.action.rationale?.match(/recommendation:[^ |]+/)?.[0].replace('recommendation:', ''),
    commercialRoute: input.action.actionType.includes('prospect') ? 'find' : input.action.actionType.includes('partnership') ? 'audience' : 'recover',
    capability: capability.name,
    actorUserId: input.actorUserId,
    approvalId: input.approvalId,
    approvalState: input.approvalState,
    provider: input.providerConfigured ? 'configured' : undefined,
    countryCode: input.countryCode,
    jurisdiction: input.jurisdiction,
    estimatedCost: input.estimatedExternalCost,
    riskLevel: capability.riskClass,
    autonomyMode: input.autonomyMode ?? 'always_ask',
    correlationId: `correlation-${input.action.id}`,
    createdAt: now,
  };
}

export function evaluateExecutionPolicy(input: ExecutionPolicyInput, governor: CostGovernor = new CostGovernor()): ExecutionPolicyResult {
  const capability = getCapability(input.capability);
  const context = createContext(input, capability);
  const reasons: string[] = [];
  let decision = 'eligible_for_dry_run' as ExecutionPolicyResult['decision'];
  if (input.action.workspaceId !== input.workspaceId) { decision = 'blocked'; reasons.push('Action is outside the requested workspace.'); }
  else if (input.approvalState !== 'approved' && capability.requiresApproval) { decision = 'requires_fresh_approval'; reasons.push('Owner approval is required.'); }
  else if (input.audienceSafety === 'prohibited') { decision = 'blocked'; reasons.push('Audience safety prohibits this action.'); }
  else if (input.audienceSafety === 'review_required') { decision = 'requires_review'; reasons.push('Audience safety review is required.'); }
  else if (!capability.enabled) { decision = 'blocked'; reasons.push('Capability is disabled.'); }
  else if (!PLATFORM_EXECUTION_ENABLED && capability.externalSideEffect) { decision = 'blocked'; reasons.push('Platform execution is disabled.'); }
  else if (capability.requiresProvider && !input.providerConfigured) { decision = 'requires_provider'; reasons.push('Required provider is not configured.'); }
  else if (input.countryCode && input.countryCode !== 'GB' && capability.jurisdictionSensitive) { decision = 'not_supported'; reasons.push('International execution is not supported in V1.'); }
  else if (input.estimatedExternalCost > 0 && governor.decide(input.workspaceId, 1, 'premium') !== 'allow') { decision = 'blocked_by_cost'; reasons.push('Cost Governor did not allow this estimated cost.'); }
  else if (input.autonomyMode === 'disabled') { decision = 'blocked'; reasons.push('Autonomy is disabled.'); }
  else if (input.autonomyMode !== 'always_ask' && !capability.allowedAutonomy.includes(input.autonomyMode ?? 'always_ask')) { decision = 'requires_review'; reasons.push('This capability is not approved for the selected autonomy mode.'); }
  if (decision === 'eligible_for_dry_run') reasons.push('Internal dry-run is eligible; real execution remains disabled.');
  return { decision, reasons, capability, context };
}

export function createDryRunPlan(input: ExecutionPolicyInput, governor?: CostGovernor): DryRunExecutionPlan {
  const result = evaluateExecutionPolicy(input, governor);
  return {
    status: result.decision === 'eligible_for_dry_run' ? 'ready_for_dry_run' : 'execution_blocked',
    decision: result.decision,
    capability: result.capability.name,
    externalProvider: input.providerConfigured ? result.context.provider : undefined,
    externalCommunication: result.capability.externalSideEffect,
    estimatedExternalCost: input.estimatedExternalCost,
    targetWorkspaceId: input.workspaceId,
    actionId: input.action.id,
    expectedSideEffects: result.decision === 'eligible_for_dry_run' ? ['Draft-only internal plan; no external effect.'] : [],
    reasons: result.reasons,
    executionEnabled: false,
  };
}

export function capabilityForAction(action: REVActionRecord): string {
  if (action.actionType === 'research_prospects') return 'RESEARCH_PROSPECTS';
  if (action.actionType === 'research_partnerships') return 'RESEARCH_PARTNERSHIPS';
  if (action.actionType === 'review_recovery_opportunities') return 'PREPARE_FOLLOW_UP';
  return 'PREPARE_FOLLOW_UP';
}

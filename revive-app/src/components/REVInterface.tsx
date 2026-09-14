import React, { useMemo, useState } from 'react';
import { useAppStore } from '@/hooks/useAppStore';
import { WorkspaceService } from '@/services/workspaceService';
import { GoalService } from '@/services/goalService';
import { REVActionService } from '@/services/revActionService';
import { ApprovalService } from '@/services/approvalService';
import { AIService } from '@/services/aiService';
import { capabilityForAction, createDryRunPlan } from '@/services/executionPolicyService';
import { dataProviderMode } from '@/data/provider';
import { ActionStatus, ApprovalDecision, ContactRecord, GoalRecord, REVActionRecord } from '@/domain/models';

interface REVInterfaceProps {
  workspaceId: string;
}

const SPECIALIST_SKILLS = [
  'Outreach',
  'Lead Research',
  'Follow-Up',
  'Marketing',
  'Reviews',
  'Bid Writer',
  'Grant Writer',
  'Website',
  'Customer Reactivation',
  'Scheduling',
  'Business Research',
];

const WORK_QUEUE_LABEL: Record<ActionStatus, string> = {
  proposed: 'Planned',
  awaiting_approval: 'Waiting for approval',
  approved: 'Approved — not executed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  completed: 'Completed',
  failed: 'Blocked',
};

const WORK_QUEUE_TONE: Record<ActionStatus, string> = {
  proposed: 'badge-neutral',
  awaiting_approval: 'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
  cancelled: 'badge-neutral',
  completed: 'badge-success',
  failed: 'badge-danger',
};

export function qualityGateLabel(action: REVActionRecord): string {
  if (!action.rationale) return 'Needs evidence';
  if (action.status === 'awaiting_approval') return 'Ready for approval';
  if (action.status === 'proposed') return 'Draft';
  return 'Checked';
}

function revStatus(actions: REVActionRecord[], pendingApprovalCount: number): 'Ready' | 'Working' | 'Waiting for approval' {
  if (pendingApprovalCount > 0) return 'Waiting for approval';
  if (actions.some((action) => action.status === 'proposed' || action.status === 'awaiting_approval')) return 'Working';
  return 'Ready';
}

export const REVInterface: React.FC<REVInterfaceProps> = ({ workspaceId }) => {
  if (dataProviderMode === 'supabase') return <LiveRevWorkspace />;
  return <MockRevWorkspace workspaceId={workspaceId} />;
};

const MockRevWorkspace: React.FC<REVInterfaceProps> = ({ workspaceId }) => {
  const { currentUser } = useAppStore();
  const provider = useMemo(() => WorkspaceService.getDataProvider(), []);
  const goalService = useMemo(() => new GoalService(provider), [provider]);
  const actionService = useMemo(() => new REVActionService(provider), [provider]);
  const approvalService = useMemo(() => new ApprovalService(provider), [provider]);
  const [, setVersion] = useState(0);
  const [editingApprovalId, setEditingApprovalId] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'rev'; content: string }[]>([
    { role: 'rev', content: "Hi, I'm REV. Tell me what you'd like your business to achieve and I'll get to work." },
  ]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  const goals: GoalRecord[] = goalService.list(workspaceId);
  const actions: REVActionRecord[] = actionService.list(workspaceId);
  const approvals = approvalService.list(workspaceId);
  const contacts: ContactRecord[] = provider.contacts.list(workspaceId);
  const contactName = (contactId?: string) => contacts.find((contact) => contact.id === contactId)?.name;

  const primaryGoal = goals.find((goal) => goal.status === 'active') ?? goals[0];
  const pendingApprovals = approvals.filter((approval) => !approval.decision);
  const actionForApproval = (revActionId: string) => actions.find((action) => action.id === revActionId);
  const completedActions = actions.filter((action) => action.status === 'completed');
  const outcomeActions = completedActions.filter((action) => action.outcomeSummary);
  const status = revStatus(actions, pendingApprovals.length);
  const executionPlans = actions.slice(0, 3).map((action) => createDryRunPlan({
    action,
    capability: capabilityForAction(action),
    actorUserId: currentUser.id,
    workspaceId,
    approvalId: approvals.find((approval) => approval.revActionId === action.id)?.id,
    approvalState: action.status === 'approved' ? 'approved' : action.status === 'rejected' ? 'rejected' : 'pending',
    audienceSafety: 'allowed',
    estimatedExternalCost: 0,
    providerConfigured: false,
    countryCode: 'GB',
  }));

  const handleDecide = (approvalId: string, decision: ApprovalDecision, notes?: string) => {
    approvalService.decide(workspaceId, approvalId, decision, currentUser.id, notes);
    setEditingApprovalId(null);
    setEditNotes('');
    setVersion((v) => v + 1);
  };

  const handleSendMessage = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!input.trim()) return;
    setMessages((prev) => [...prev, { role: 'user', content: input }]);
    const response = await AIService.reason(input, { workspaceData: { goals, actions }, context: 'REV Workspace' });
    setMessages((prev) => [...prev, { role: 'rev', content: response.content }]);
    setInput('');
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      {/* Header / status */}
      <section className="order-0 rev-motion-in card p-6 bg-gradient-to-r from-primary-600 to-primary-700 text-white">
        <p className="text-xs font-semibold tracking-[0.2em] text-primary-100">REV</p>
        <h1 className="text-3xl font-bold mt-1">Your AI Growth Employee</h1>
        <span className="badge bg-white/15 text-white mt-4 inline-block" role="status">
          {status}
        </span>
      </section>

      {/* Current objective */}
      <section aria-labelledby="objective-heading" className="order-1 sm:order-1 rev-motion-in">
        <h2 id="objective-heading" className="text-xl font-bold text-neutral-900 mb-4">
          CURRENT OBJECTIVE
        </h2>
        {primaryGoal ? (
          <div className="card p-6">
            <p className="text-neutral-900 font-medium">{primaryGoal.objective}</p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex-1 w-full bg-neutral-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary-600 h-full transition-all"
                  style={{ width: `${Math.min(100, (primaryGoal.currentValue / primaryGoal.targetValue) * 100)}%` }}
                />
              </div>
              <span className="text-sm font-semibold text-neutral-900 whitespace-nowrap">
                {primaryGoal.currentValue} / {primaryGoal.targetValue}
              </span>
            </div>
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No active objective has been set for this workspace yet.</div>
        )}
      </section>

      {/* Conversation / task input */}
      <section aria-labelledby="input-heading" className="order-2 sm:order-2 rev-motion-in">
        <h2 id="input-heading" className="text-xl font-bold text-neutral-900 mb-4">
          TALK TO REV
        </h2>
        <div className="card overflow-hidden">
          <div className="max-h-72 overflow-y-auto p-4 bg-neutral-50 space-y-3">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-sm px-4 py-2 rounded-lg text-sm ${
                    message.role === 'user' ? 'bg-primary-600 text-white' : 'bg-white border border-neutral-200 text-neutral-900'
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={handleSendMessage} className="flex gap-2 p-4 border-t border-neutral-200">
            <label className="sr-only" htmlFor="rev-task-input">
              Tell REV what you want to achieve
            </label>
            <input
              id="rev-task-input"
              className="input-field flex-1"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. Follow up my old quotes"
            />
            <button className="btn-primary" type="submit">
              Send
            </button>
          </form>
          <p className="px-4 pb-4 text-xs text-neutral-500">Demo reasoning only — REV AI execution is not connected yet.</p>
        </div>
      </section>

      {/* What REV is working on */}
      <section aria-labelledby="work-heading" className="order-4 sm:order-3 rev-motion-in">
        <h2 id="work-heading" className="text-xl font-bold text-neutral-900 mb-4">
          WHAT REV IS WORKING ON
        </h2>
        {actions.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {actions.map((action) => (
              <li key={action.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-neutral-900">{action.title}</p>
                  <span className={WORK_QUEUE_TONE[action.status]}>{WORK_QUEUE_LABEL[action.status]}</span>
                </div>
                <p className="text-sm text-neutral-600 mt-1">{action.description}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-neutral-500">
                  {contactName(action.contactId) && <span>Related to {contactName(action.contactId)}</span>}
                  <span>Quality gate: {qualityGateLabel(action)}</span>
                  {!action.rationale && <span className="font-semibold text-amber-700">EVIDENCE REQUIRED</span>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">REV has no work in progress for this workspace.</div>
        )}
      </section>

      {/* Recommendations */}
      <section aria-labelledby="recommendations-heading" className="order-5 sm:order-4 rev-motion-in">
        <h2 id="recommendations-heading" className="text-xl font-bold text-neutral-900 mb-4">
          RECOMMENDATIONS
        </h2>
        {actions.filter((action) => action.rationale).length > 0 ? (
          <div className="space-y-3">
            {actions
              .filter((action) => action.rationale)
              .map((action) => (
                <div key={action.id} className="card p-4 bg-primary-50 border-primary-200">
                  <p className="text-primary-900 font-medium">{action.title}</p>
                  <p className="text-sm text-primary-800 mt-1">{action.rationale}</p>
                </div>
              ))}
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">REV has no recommendations right now.</div>
        )}
      </section>

      <section aria-labelledby="readiness-heading" className="order-6 sm:order-6 rev-motion-in">
        <h2 id="readiness-heading" className="text-xl font-bold text-neutral-900 mb-4">EXECUTION READINESS</h2>
        {executionPlans.length > 0 ? (
          <div className="space-y-3">
            {executionPlans.map((plan) => (
              <div key={plan.actionId} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-neutral-900">{actions.find((action) => action.id === plan.actionId)?.title}</p>
                    <p className="text-sm text-neutral-600">Capability: {plan.capability}</p>
                  </div>
                  <span className={plan.status === 'ready_for_dry_run' ? 'badge-success' : 'badge-warning'}>
                    {plan.status === 'ready_for_dry_run' ? 'Ready for dry run' : 'Execution blocked'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3 mt-3 text-xs text-neutral-600">
                  <span>External effect: {plan.externalCommunication ? 'External communication' : 'None'}</span>
                  <span>Expected cost: {plan.estimatedExternalCost === 0 ? '£0' : `£${plan.estimatedExternalCost}`}</span>
                  <span>Execution: Disabled</span>
                </div>
                <button className="btn-secondary text-sm mt-3" type="button" onClick={() => setExpandedPlanId(expandedPlanId === plan.actionId ? null : plan.actionId)}>
                  {expandedPlanId === plan.actionId ? 'Hide execution plan' : 'View execution plan'}
                </button>
                {expandedPlanId === plan.actionId && (
                  <div className="mt-3 border-t border-neutral-200 pt-3 text-sm text-neutral-700">
                    <p><strong>Policy:</strong> {plan.decision.replace(/_/g, ' ')}</p>
                    {plan.reasons.map((reason) => <p key={reason} className="mt-1">{reason}</p>)}
                    {plan.expectedSideEffects.map((effect) => <p key={effect} className="mt-1"><strong>Side effect:</strong> {effect}</p>)}
                    <p className="mt-1 font-semibold text-neutral-900">No Execute action is available in this phase.</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">Execution planning is unavailable until REV has a proposed action.</div>
        )}
      </section>

      {/* Approvals */}
      <section aria-labelledby="approvals-heading" className="order-3 sm:order-7 rev-motion-in">
        <h2 id="approvals-heading" className="text-xl font-bold text-neutral-900 mb-4">
          {pendingApprovals.length > 0 ? 'REV NEEDS YOUR APPROVAL' : 'APPROVALS'}
        </h2>
        {pendingApprovals.length > 0 ? (
          <div className="card p-6 border-2 border-yellow-200 bg-yellow-50 space-y-4">
            {pendingApprovals.map((approval) => {
              const action = actionForApproval(approval.revActionId);
              if (!action) return null;
              return (
                <div key={approval.id} className="bg-white p-4 rounded-lg border border-yellow-100">
                  <h3 className="font-semibold text-neutral-900">{action.title}</h3>
                  <p className="text-sm text-neutral-600 mt-1">{action.rationale ?? 'EVIDENCE REQUIRED'}</p>
                  <div className="mt-3 grid gap-1 text-xs text-neutral-600">
                    <p><strong>What REV will do:</strong> {action.description}</p>
                    <p><strong>External effect:</strong> NONE. Execution is disabled in this phase.</p>
                    <p><strong>Approval:</strong> {action.status === 'approved' ? 'APPROVED — NOT EXECUTED' : 'Required before any future execution.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {!approval.decision && <button className="btn-primary text-sm" type="button" onClick={() => handleDecide(approval.id, 'approved')}>
                      Approve
                    </button>}
                    {!approval.decision && <button
                      className="btn-secondary text-sm"
                      type="button"
                      onClick={() => setEditingApprovalId(editingApprovalId === approval.id ? null : approval.id)}
                    >
                      Edit
                    </button>}
                    {!approval.decision && <button className="btn-ghost text-sm" type="button" onClick={() => handleDecide(approval.id, 'rejected')}>
                      Reject
                    </button>}
                  </div>
                  {editingApprovalId === approval.id && (
                    <div className="mt-3 flex gap-2">
                      <label className="sr-only" htmlFor={`edit-notes-${approval.id}`}>
                        Edit notes
                      </label>
                      <input
                        id={`edit-notes-${approval.id}`}
                        className="input-field flex-1"
                        placeholder="Add an edit note before approving"
                        value={editNotes}
                        onChange={(event) => setEditNotes(event.target.value)}
                      />
                      <button className="btn-primary text-sm" type="button" onClick={() => handleDecide(approval.id, 'edited', editNotes)}>
                        Save & approve
                      </button>
                    </div>
                  )}
                  <p className="text-xs text-neutral-500 mt-2">Approved actions remain APPROVED — NOT EXECUTED.</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card p-6 bg-neutral-100 text-center text-neutral-600">No pending approvals. REV is ready for new tasks.</div>
        )}
      </section>

      {/* Recently completed */}
      <section aria-labelledby="completed-heading" className="order-6 sm:order-6 rev-motion-in">
        <h2 id="completed-heading" className="text-xl font-bold text-neutral-900 mb-4">
          RECENTLY COMPLETED
        </h2>
        {completedActions.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {completedActions.map((action) => (
              <li key={action.id} className="p-4">
                <p className="font-medium text-neutral-900">{action.title}</p>
                {action.outcomeSummary && <p className="text-sm text-neutral-600 mt-1">{action.outcomeSummary}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No completed REV work yet.</div>
        )}
      </section>

      {/* Outcomes / impact */}
      <section aria-labelledby="outcomes-heading" className="order-7 sm:order-7 rev-motion-in">
        <h2 id="outcomes-heading" className="text-xl font-bold text-neutral-900 mb-4">
          OUTCOMES
        </h2>
        {outcomeActions.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {outcomeActions.map((action) => (
              <li key={action.id} className="p-4 text-neutral-700">
                {action.outcomeSummary}
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">
            No measurable outcomes recorded yet. Full revenue intelligence arrives in Phase 3D.
          </div>
        )}
      </section>

      {/* Specialist skills */}
      <section aria-labelledby="skills-heading" className="order-8 sm:order-8 rev-motion-in">
        <h2 id="skills-heading" className="text-xl font-bold text-neutral-900 mb-4">
          REV SKILLS
        </h2>
        <div className="flex flex-wrap gap-2">
          {SPECIALIST_SKILLS.map((skill) => (
            <span key={skill} className="badge-neutral">
              {skill}
            </span>
          ))}
        </div>
        <p className="text-xs text-neutral-500 mt-2">Shown as available REV capabilities; not all skills are operational yet.</p>
      </section>
    </div>
  );
};

/**
 * Live (Supabase) mode REV workspace. Goals/actions/approvals repositories remain
 * mock-only per Phase 2D.2 scope, so this surface shows honest empty states rather
 * than fabricating REV work or AI reasoning.
 */
const LiveRevWorkspace: React.FC = () => (
  <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
    <section className="rev-motion-in card p-6 bg-gradient-to-r from-primary-600 to-primary-700 text-white">
      <p className="text-xs font-semibold tracking-[0.2em] text-primary-100">REV</p>
      <h1 className="text-3xl font-bold mt-1">Your AI Growth Employee</h1>
      <span className="badge bg-white/15 text-white mt-4 inline-block" role="status">
        Not yet connected
      </span>
    </section>
    <LiveEmptySection title="CURRENT OBJECTIVE" message="Goals are not yet connected to live workspace data." />
    <LiveEmptySection title="TALK TO REV" message="REV AI execution is not connected yet." />
    <LiveEmptySection title="WHAT REV IS WORKING ON" message="REV work items are not yet available in live mode." />
    <LiveEmptySection title="RECOMMENDATIONS" message="REV recommendations are not yet available in live mode." />
    <LiveEmptySection title="APPROVALS" message="Live approvals are not yet available in this mode." />
    <LiveEmptySection title="RECENTLY COMPLETED" message="No completed REV work is available in live mode yet." />
    <LiveEmptySection title="OUTCOMES" message="Outcome tracking is not yet connected to live workspace data." />
  </div>
);

const LiveEmptySection: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <section className="rev-motion-in">
    <h2 className="text-xl font-bold text-neutral-900 mb-4">{title}</h2>
    <div className="card p-6 text-center text-neutral-600">{message}</div>
  </section>
);

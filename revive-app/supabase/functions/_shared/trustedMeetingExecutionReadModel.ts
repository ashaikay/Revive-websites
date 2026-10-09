/** Service-role-only read model. The client must never come from request JSON.
 * The claim RPC remains the final atomic authority immediately before Graph. */
export interface TrustedMeetingReadClient {
  rpc(name: 'load_rev_meeting_execution_calendar_target', args: {
    target_execution_id: string;
  }): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'load_rev_meeting_calendar_credential', args: {
    target_execution_id: string;
  }): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'rotate_rev_meeting_calendar_credential', args: {
    target_execution_id: string;
    expected_revision: number;
    target_refresh_token: string;
  }): Promise<{ data: unknown; error: unknown }>;
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        eq(column: string, value: string): {
          maybeSingle(): Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  };
}
export interface TrustedMeetingExecutionSnapshot {
  executionId: string;
  workspaceId: string;
  actionId: string;
  approvalId: string;
  requestFingerprint: string;
  bindingVersion: number;
  calendarId: string;
  connectionId: string;
  credentialReference: string;
  credentialRevision: number;
  consentVersion: number;
  calendarReference: string;
  providerCalendarReference: string;
  targetFingerprint: string;
  timezone: string;
  semanticIdempotencyKey: string;
  proposal: Record<string, unknown>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Trusted meeting snapshot unavailable.');
  return value as Record<string, unknown>;
}
async function load(client: TrustedMeetingReadClient, table: string, left: [string, string], right: [string, string]) {
  const { data, error } = await client.from(table).select('*').eq(...left).eq(...right).maybeSingle();
  if (error || !data) throw new Error('Trusted meeting snapshot unavailable.');
  return object(data);
}
export function createTrustedMeetingExecutionReadModel(client: TrustedMeetingReadClient) {
  return async function loadTrustedMeetingExecution(executionId: string): Promise<TrustedMeetingExecutionSnapshot> {
    if (!uuid.test(executionId)) throw new Error('Trusted meeting snapshot unavailable.');
    // Each lookup is scoped to the workspace/action from the durable execution.
    const execution = await load(client, 'rev_action_executions', ['id', executionId], ['capability', 'CREATE_APPROVED_MEETING_EVENT']);
    const workspaceId = execution.workspace_id;
    const actionId = execution.action_id;
    const approvalId = execution.approval_id;
    if (typeof workspaceId !== 'string' || !uuid.test(workspaceId) ||
      typeof actionId !== 'string' || !uuid.test(actionId) ||
      typeof approvalId !== 'string' || !uuid.test(approvalId) ||
      execution.status !== 'prepared' || execution.mode !== 'dry_run' ||
      execution.provider_outcome !== 'provider_not_invoked' ||
      typeof execution.request_fingerprint !== 'string' || !sha256.test(execution.request_fingerprint) ||
      typeof execution.idempotency_key !== 'string' || !execution.idempotency_key.startsWith('create-approved-meeting-event:')) {
      throw new Error('Trusted meeting snapshot unavailable.');
    }
    const action = await load(client, 'rev_actions', ['workspace_id', workspaceId], ['id', actionId]);
    const approval = await load(client, 'approvals', ['workspace_id', workspaceId], ['id', approvalId]);
    const proposal = await load(client, 'meeting_proposals', ['workspace_id', workspaceId], ['rev_action_id', actionId]);
    const targetResult = await client.rpc('load_rev_meeting_execution_calendar_target', {
      target_execution_id: executionId,
    });
    const targetRows = Array.isArray(targetResult.data) ? targetResult.data : [targetResult.data];
    const target = !targetResult.error && targetRows.length === 1 ? object(targetRows[0]) : null;
    if (action.action_type !== 'meeting_proposal' || action.status !== 'approved' ||
      action.execution_status !== 'not_executed' || action.action_version !== execution.action_version ||
      approval.rev_action_id !== actionId || approval.decision !== 'approved' ||
      approval.action_version !== execution.action_version ||
      approval.action_fingerprint !== execution.approval_fingerprint ||
      proposal.approval_id !== approvalId || proposal.proposal_version !== execution.action_version ||
      !target || target.execution_id !== executionId || target.workspace_id !== workspaceId ||
      typeof target.calendar_id !== 'string' || !uuid.test(target.calendar_id) ||
      typeof target.connection_id !== 'string' || !uuid.test(target.connection_id) ||
      typeof target.credential_reference !== 'string' || !uuid.test(target.credential_reference) ||
      !Number.isSafeInteger(target.credential_revision) || (target.credential_revision as number) < 1 ||
      typeof target.provider_account_reference !== 'string' || !target.provider_account_reference.trim() ||
      typeof target.provider_calendar_reference !== 'string' || !target.provider_calendar_reference.trim() ||
      !Number.isSafeInteger(target.consent_version) || (target.consent_version as number) < 1 ||
      typeof target.timezone !== 'string' || !target.timezone.trim() ||
      typeof target.target_fingerprint !== 'string' || !sha256.test(target.target_fingerprint) ||
      !Number.isSafeInteger(target.workspace_binding_version) || (target.workspace_binding_version as number) < 1) {
      throw new Error('Trusted meeting snapshot unavailable.');
    }
    const payload = object(proposal.proposal_payload);
    if (payload.timezone !== target.timezone || payload.version !== proposal.proposal_version ||
      typeof payload.title !== 'string' || !payload.title.trim() ||
      typeof payload.attendeeEmail !== 'string' || !payload.attendeeEmail.includes('@') ||
      typeof payload.startAt !== 'string' || typeof payload.endAt !== 'string' ||
      !Number.isFinite(Date.parse(payload.startAt)) || !Number.isFinite(Date.parse(payload.endAt)) ||
      Date.parse(payload.startAt) <= Date.now() || Date.parse(payload.endAt) <= Date.parse(payload.startAt)) {
      throw new Error('Trusted meeting snapshot unavailable.');
    }
    return {
      executionId, workspaceId, actionId, approvalId,
      requestFingerprint: execution.request_fingerprint,
      bindingVersion: target.workspace_binding_version as number,
      calendarId: target.calendar_id,
      connectionId: target.connection_id,
      credentialReference: target.credential_reference,
      credentialRevision: target.credential_revision as number,
      consentVersion: target.consent_version as number,
      calendarReference: target.provider_account_reference,
      providerCalendarReference: target.provider_calendar_reference,
      targetFingerprint: target.target_fingerprint,
      timezone: target.timezone,
      semanticIdempotencyKey: execution.idempotency_key,
      proposal: payload,
    };
  };
}

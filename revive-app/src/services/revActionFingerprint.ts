export interface FingerprintableREVAction {
  id: string;
  workspaceId: string;
  goalId?: string;
  contactId?: string;
  opportunityId?: string;
  actionType: string;
  title: string;
  description: string;
  rationale?: string;
  requiresApproval: boolean;
  actionVersion: number;
}

function postgresJsonbText(value: Record<string, string | number | boolean | null>): string {
  const keys = Object.keys(value).sort((left, right) => {
    const lengthDifference = new TextEncoder().encode(left).length - new TextEncoder().encode(right).length;
    return lengthDifference || (left < right ? -1 : left > right ? 1 : 0);
  });
  return `{${keys.map((key) => `${JSON.stringify(key)}: ${JSON.stringify(value[key])}`).join(', ')}}`;
}

export async function fingerprintREVAction(action: FingerprintableREVAction): Promise<string> {
  const material = postgresJsonbText({
    id: action.id,
    workspace_id: action.workspaceId,
    goal_id: action.goalId ?? null,
    contact_id: action.contactId ?? null,
    opportunity_id: action.opportunityId ?? null,
    action_type: action.actionType,
    title: action.title,
    description: action.description,
    rationale: action.rationale ?? null,
    requires_approval: action.requiresApproval,
    action_version: action.actionVersion,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deterministicUuid(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Mirrors the retained-request pattern used by Programme Hub and employer engagement saves:
// an unconfirmed write is kept in sessionStorage so it survives refresh and can only be
// resolved by replaying the exact same payload and request ID.
export type ActionPlanSavePayload = {
  target_workspace_id: string;
  target_programme_id: string;
  target_participant_id: string;
  expected_revision: number;
  target_template_version_id: string;
  target_goal: string;
  target_actions: unknown[];
};
export type ActionPlanAttempt = {
  userId: string;
  workspaceId: string;
  programmeId: string;
  participantId: string;
  requestId: string;
  payload: ActionPlanSavePayload;
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const retainedKey = (workspaceId: string, userId: string, programmeId: string) =>
  `rev-programme-action-plan:${workspaceId}:${userId}:${programmeId}`;

export const rememberActionPlanAttempt = (storage: StorageLike, attempt: ActionPlanAttempt) =>
  storage.setItem(retainedKey(attempt.workspaceId, attempt.userId, attempt.programmeId), JSON.stringify(attempt));

export const clearActionPlanAttempt = (storage: StorageLike, workspaceId: string, userId: string, programmeId: string) =>
  storage.removeItem(retainedKey(workspaceId, userId, programmeId));

export const restoreActionPlanAttempt = (storage: StorageLike, workspaceId: string, userId: string, programmeId: string): ActionPlanAttempt | null => {
  const raw = storage.getItem(retainedKey(workspaceId, userId, programmeId));
  if (raw === null) return null;
  const value = JSON.parse(raw) as Partial<ActionPlanAttempt> | null;
  const payload = value?.payload;
  if (!value || typeof value !== 'object' || value.userId !== userId || value.workspaceId !== workspaceId
    || value.programmeId !== programmeId || typeof value.participantId !== 'string' || !value.participantId
    || typeof value.requestId !== 'string' || !uuid.test(value.requestId)
    || !payload || typeof payload !== 'object' || payload.target_workspace_id !== workspaceId
    || payload.target_programme_id !== programmeId || payload.target_participant_id !== value.participantId
    || !Number.isSafeInteger(payload.expected_revision) || typeof payload.target_template_version_id !== 'string'
    || typeof payload.target_goal !== 'string' || !Array.isArray(payload.target_actions)) {
    throw new Error('A retained action plan request is invalid.');
  }
  return value as ActionPlanAttempt;
};

/** Participant whose action plan has an unresolved save, or null. Never throws. */
export const retainedActionPlanParticipant = (storage: StorageLike, workspaceId: string, userId: string, programmeId: string) => {
  try {
    return restoreActionPlanAttempt(storage, workspaceId, userId, programmeId)?.participantId ?? null;
  } catch {
    return null;
  }
};

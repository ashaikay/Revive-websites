import { supabaseClient } from '@/data/supabaseClient';
import {
  mapMeetingOutcome,
  validateMeetingOutcomeAttempt,
  type MeetingOutcome,
  type MeetingOutcomeAttempt,
} from '@/domain/meetingOutcome';

export type MeetingOutcomeInvoker = (
  name: string,
  body: Record<string, unknown>,
) => Promise<{ status: number; data: unknown }>;

export async function submitMeetingOutcome(
  value: MeetingOutcomeAttempt,
  invoke: MeetingOutcomeInvoker = async (name, body) => {
    if (!supabaseClient) throw new Error('Meeting outcome recording is unavailable.');
    const { data, error } = await supabaseClient.functions.invoke(name, { body });
    if (error) throw new Error('Meeting outcome save is unconfirmed.');
    return { status: 200, data };
  },
): Promise<MeetingOutcome> {
  const attempt = validateMeetingOutcomeAttempt(value);
  const response = await invoke('rev-meeting-outcome-save', { ...attempt });
  if (response.status !== 200) throw new Error('Meeting outcome save is unconfirmed.');
  const result = mapMeetingOutcome(response.data, attempt.workspaceId);
  if (result.meetingProposalId !== attempt.meetingProposalId
    || result.outcomeType !== attempt.outcomeType
    || result.summary !== attempt.summary
    || result.occurredAt !== attempt.occurredAt
    || result.version < 1) {
    throw new Error('Meeting outcome save is unconfirmed.');
  }
  return result;
}

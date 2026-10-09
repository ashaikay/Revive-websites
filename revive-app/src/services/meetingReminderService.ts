import { supabaseClient } from '@/data/supabaseClient';
import {
  mapMeetingReminderDraft,
  validateMeetingReminderDraftAttempt,
  type MeetingReminderDraft,
  type MeetingReminderDraftAttempt,
} from '@/domain/meetingReminder';

export type MeetingReminderInvoker = (
  name: string,
  body: Record<string, unknown>,
) => Promise<{ status: number; data: unknown }>;

export async function submitMeetingReminderDraft(
  value: MeetingReminderDraftAttempt,
  invoke: MeetingReminderInvoker = async (name, body) => {
    if (!supabaseClient) throw new Error('Meeting reminder preparation is unavailable.');
    const { data, error } = await supabaseClient.functions.invoke(name, { body });
    if (error) throw new Error('Meeting reminder save is unconfirmed.');
    return { status: 200, data };
  },
): Promise<MeetingReminderDraft> {
  const attempt = validateMeetingReminderDraftAttempt(value);
  const response = await invoke('rev-meeting-reminder-save', { ...attempt });
  if (response.status !== 200) throw new Error('Meeting reminder save is unconfirmed.');
  const result = mapMeetingReminderDraft(response.data, attempt.workspaceId);
  if (result.meetingProposalId !== attempt.meetingProposalId
    || result.body !== attempt.body
    || result.version < 1) {
    throw new Error('Meeting reminder save is unconfirmed.');
  }
  return result;
}

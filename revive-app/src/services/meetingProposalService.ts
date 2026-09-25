export type MeetingMethod = 'online' | 'phone' | 'in_person';

export interface MeetingProposalInput {
  title: string;
  attendeeEmail: string;
  meetingMethod: MeetingMethod;
  locationDetails: string;
  notes: string;
}

export interface PreparedMeetingProposal extends MeetingProposalInput {
  startAt: string;
  endAt: string;
  timezone: string;
}

export type MeetingProposalValidationErrors = Partial<Record<keyof MeetingProposalInput, string>>;

export type MeetingProposalValidationResult =
  | { valid: true; proposal: PreparedMeetingProposal }
  | { valid: false; errors: MeetingProposalValidationErrors };

export const INITIAL_MEETING_PROPOSAL_INPUT: MeetingProposalInput = {
  title: '',
  attendeeEmail: '',
  meetingMethod: 'online',
  locationDetails: '',
  notes: '',
};

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function prepareMeetingProposal(
  input: MeetingProposalInput,
  selectedSlot: { startAt: string; endAt: string },
  timezone: string,
): MeetingProposalValidationResult {
  const title = input.title.trim();
  const attendeeEmail = input.attendeeEmail.trim().toLowerCase();
  const locationDetails = input.locationDetails.trim();
  const notes = input.notes.trim();
  const errors: MeetingProposalValidationErrors = {};

  if (!title) errors.title = 'Meeting title is required.';
  else if (title.length > 120) errors.title = 'Meeting title must be 120 characters or fewer.';
  if (!attendeeEmail) errors.attendeeEmail = 'Attendee email is required.';
  else if (!validEmail(attendeeEmail)) errors.attendeeEmail = 'Enter a valid attendee email address.';
  if (!['online', 'phone', 'in_person'].includes(input.meetingMethod)) errors.meetingMethod = 'Choose a meeting method.';
  if (locationDetails.length > 240) errors.locationDetails = 'Location/details must be 240 characters or fewer.';
  if (notes.length > 1000) errors.notes = 'Notes must be 1,000 characters or fewer.';
  if (Object.keys(errors).length > 0) return { valid: false, errors };

  return {
    valid: true,
    proposal: { title, attendeeEmail, meetingMethod: input.meetingMethod, locationDetails, notes, startAt: selectedSlot.startAt, endAt: selectedSlot.endAt, timezone },
  };
}
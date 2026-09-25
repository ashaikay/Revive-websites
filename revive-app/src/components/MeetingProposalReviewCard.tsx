import React, { useState } from 'react';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';

export interface MeetingProposalReviewCardProps {
  action: LivePendingAction;
  canReview: boolean;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => Promise<void>;
}

function formatMeetingDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value));
}

function formatMeetingTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function meetingMethodLabel(method: 'online' | 'phone' | 'in_person'): string {
  if (method === 'in_person') return 'In person';
  return method === 'phone' ? 'Phone' : 'Online';
}

export const MeetingProposalReviewCard: React.FC<MeetingProposalReviewCardProps> = ({
  action,
  canReview,
  busy,
  onDecision,
}) => {
  const [confirmation, setConfirmation] = useState<'approved' | 'rejected' | null>(null);
  const proposal = action.meetingProposal;

  if (!proposal) {
    return (
      <div className="p-5">
        <p className="font-semibold text-neutral-900">Meeting proposal unavailable</p>
        <p className="text-sm text-neutral-600 mt-2">The trusted meeting snapshot could not be loaded. Reload before making a decision.</p>
      </div>
    );
  }

  return (
    <article className="p-5" aria-labelledby={`meeting-proposal-${action.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p id={`meeting-proposal-${action.id}`} className="font-semibold text-neutral-900">{proposal.title}</p>
          <p className="text-sm text-neutral-600 mt-1">Attendee: {proposal.attendeeEmail}</p>
        </div>
        <span className="badge-warning whitespace-nowrap">MEETING PROPOSAL — NOT BOOKED</span>
      </div>

      <dl className="grid gap-2 mt-4 text-sm text-neutral-700 sm:grid-cols-2">
        <div><dt className="font-medium text-neutral-900">Date</dt><dd>{formatMeetingDate(proposal.startAt, proposal.timezone)}</dd></div>
        <div><dt className="font-medium text-neutral-900">Time</dt><dd>{formatMeetingTime(proposal.startAt, proposal.timezone)} - {formatMeetingTime(proposal.endAt, proposal.timezone)} ({proposal.timezone})</dd></div>
        <div><dt className="font-medium text-neutral-900">Method</dt><dd>{meetingMethodLabel(proposal.meetingMethod)}</dd></div>
        {proposal.locationDetails && <div><dt className="font-medium text-neutral-900">Location/details</dt><dd className="break-words">{proposal.locationDetails}</dd></div>}
      </dl>
      {proposal.notes && <div className="mt-3 text-sm text-neutral-700"><p className="font-medium text-neutral-900">Notes</p><p className="whitespace-pre-wrap break-words">{proposal.notes}</p></div>}

      <p className="text-xs text-neutral-500 mt-4">Approval records intent only. No calendar event, invitation, email or provider action will occur.</p>

      {canReview && !confirmation && (
        <div className="flex flex-wrap gap-3 mt-4">
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => setConfirmation('approved')}>APPROVE PROPOSAL</button>
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => setConfirmation('rejected')}>REJECT PROPOSAL</button>
        </div>
      )}

      {canReview && confirmation && (
        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm text-neutral-800">
            {confirmation === 'approved'
              ? 'Approve this exact meeting proposal? It will remain not booked.'
              : 'Reject this meeting proposal? No calendar event will be created.'}
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" className={confirmation === 'approved' ? 'btn-primary text-sm' : 'btn-secondary text-sm'} disabled={busy} onClick={() => onDecision(confirmation)}>
              {busy ? 'SAVING...' : confirmation === 'approved' ? 'CONFIRM APPROVAL' : 'CONFIRM REJECTION'}
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => setConfirmation(null)}>CANCEL</button>
          </div>
        </div>
      )}
    </article>
  );
};

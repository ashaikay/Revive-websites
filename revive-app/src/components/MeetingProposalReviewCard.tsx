import React, { useEffect, useRef, useState } from 'react';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';
import type { MeetingExecutionResult } from '@/services/meetingExecutionClient';
import { focusFeedback } from '@/utils/focusFeedback';

export interface MeetingProposalReviewCardProps {
  action: LivePendingAction;
  canReview: boolean;
  busy: boolean;
  onDecision: (decision: 'approved' | 'rejected') => Promise<void>;
  executionBusy?: boolean;
  executionError?: string;
  executionResult?: MeetingExecutionResult;
  decisionError?: string;
  decisionFeedback?: 'approved' | 'rejected';
  onClearDecisionFeedback?: (actionId: string) => void;
  onRequestDryRun?: () => Promise<void>;
  onRequestLive?: () => Promise<void>;
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

function executionPresentation(result: MeetingExecutionResult) {
  switch (result.status) {
    case 'event_created': return {
      title: 'EVENT CREATED',
      message: 'The provider confirmed event creation. Invitation delivery was not confirmed.',
      tone: 'border-green-200 bg-green-50 text-green-900',
    };
    case 'provider_rejected': return {
      title: 'EVENT NOT CREATED',
      message: 'The provider rejected the request. No calendar event was created and no invitation was sent.',
      tone: 'border-red-200 bg-red-50 text-red-900',
    };
    case 'outcome_unknown': return {
      title: 'OUTCOME UNKNOWN — CHECK CALENDAR',
      message: 'Event creation and invitation delivery could not be confirmed. Check the selected Outlook calendar and contact an administrator before taking further action. Do not retry this attempt.',
      tone: 'border-amber-200 bg-amber-50 text-amber-900',
    };
    default: return {
      title: 'BOOKING CHECK — NOTHING BOOKED',
      message: 'The booking details were checked. No calendar event was created and no invitation was sent.',
      tone: 'border-green-200 bg-green-50 text-green-900',
    };
  }
}

function proposalStatusLabel(result: MeetingExecutionResult | undefined, actionStatus: LivePendingAction['status']): string {
  if (result?.status === 'event_created') return 'EVENT CREATED';
  if (result?.status === 'provider_rejected') return 'EVENT NOT CREATED';
  if (result?.status === 'outcome_unknown') return 'OUTCOME UNKNOWN';
  if (actionStatus === 'rejected') return 'REJECTED — NOT BOOKED';
  return 'APPROVED — NOT BOOKED';
}

export const MeetingProposalReviewCard: React.FC<MeetingProposalReviewCardProps> = ({
  action,
  canReview,
  busy,
  onDecision,
  executionBusy = false,
  executionError,
  executionResult,
  decisionError,
  decisionFeedback,
  onClearDecisionFeedback,
  onRequestDryRun,
  onRequestLive,
}) => {
  const [confirmation, setConfirmation] = useState<'approved' | 'rejected' | null>(null);
  const [confirmLiveBooking, setConfirmLiveBooking] = useState(false);
  const decisionFeedbackRef = useRef<HTMLDivElement>(null);
  const decisionErrorRef = useRef<HTMLParagraphElement>(null);
  const executionFeedbackRef = useRef<HTMLDivElement>(null);
  const liveUiEnabled = import.meta.env.VITE_REV_MEETING_LIVE_UI_ENABLED === 'true';
  const proposal = action.meetingProposal;
  const displayedExecution = executionResult ?? action.meetingDryRun;
  const presentation = displayedExecution ? executionPresentation(displayedExecution) : undefined;

  useEffect(() => {
    if (!decisionFeedback) return;
    focusFeedback(decisionFeedbackRef.current);
    const timer = window.setTimeout(() => onClearDecisionFeedback?.(action.id), 5000);
    return () => window.clearTimeout(timer);
  }, [action.id, decisionFeedback, onClearDecisionFeedback]);

  useEffect(() => {
    if (decisionError) focusFeedback(decisionErrorRef.current);
  }, [decisionError]);

  useEffect(() => {
    if (executionError || executionResult) focusFeedback(executionFeedbackRef.current);
  }, [executionError, executionResult]);

  if (!proposal) {
    return (
      <div className="p-5">
        <p className="font-semibold text-neutral-900">Meeting proposal unavailable</p>
        <p className="text-sm text-neutral-600 mt-2">The trusted meeting snapshot could not be loaded. Reload before making a decision.</p>
      </div>
    );
  }

  return (
    <article className="rounded-lg border border-neutral-200 bg-white" aria-labelledby={`meeting-proposal-${action.id}`}>
      <details>
      <summary className="cursor-pointer p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
      <div className="inline-flex w-full flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p id={`meeting-proposal-${action.id}`} className="font-semibold text-neutral-900">{proposal.title}</p>
          <p className="text-sm text-neutral-600 mt-1 break-words">Attendee: {proposal.attendeeEmail}</p>
          <p className="text-sm text-neutral-700 mt-1">{formatMeetingDate(proposal.startAt, proposal.timezone)} · {formatMeetingTime(proposal.startAt, proposal.timezone)} - {formatMeetingTime(proposal.endAt, proposal.timezone)} ({proposal.timezone})</p>
        </div>
        <span className={displayedExecution?.status === 'event_created' ? 'badge-success whitespace-nowrap'
          : displayedExecution?.status === 'provider_rejected' ? 'badge-danger whitespace-nowrap'
          : displayedExecution?.status === 'outcome_unknown' || executionError ? 'badge-warning whitespace-nowrap'
          : action.status === 'rejected' ? 'badge-danger whitespace-nowrap'
          : action.status === 'approved' ? 'badge-success whitespace-nowrap' : 'badge-warning whitespace-nowrap'}>
          {action.status === 'awaiting_approval' ? 'NOT BOOKED — APPROVAL NEEDED' : proposalStatusLabel(displayedExecution, action.status)}
        </span>
      </div>
      <span className="mt-2 inline-block text-xs font-medium text-primary-700">View details and actions</span>
      </summary>
      <div className="border-t border-neutral-200 p-4">

      <dl className="grid gap-2 text-sm text-neutral-700 sm:grid-cols-2">
        <div><dt className="font-medium text-neutral-900">Method</dt><dd>{meetingMethodLabel(proposal.meetingMethod)}</dd></div>
        {proposal.locationDetails && <div><dt className="font-medium text-neutral-900">Location/details</dt><dd className="break-words">{proposal.locationDetails}</dd></div>}
      </dl>
      {proposal.notes && <div className="mt-3 text-sm text-neutral-700"><p className="font-medium text-neutral-900">Notes</p><p className="whitespace-pre-wrap break-words">{proposal.notes}</p></div>}

      {canReview && action.status === 'awaiting_approval' && !confirmation && (
        <div className="mt-4">
          <p className="text-sm text-neutral-600">Approval alone does not book the meeting.</p>
          <div className="flex flex-wrap gap-3 mt-2">
          <button type="button" className="btn-primary text-sm" disabled={busy} onClick={() => setConfirmation('approved')}>APPROVE PROPOSAL</button>
          <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => setConfirmation('rejected')}>REJECT PROPOSAL</button>
          </div>
        </div>
      )}

      {canReview && action.status === 'awaiting_approval' && confirmation && (
        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-4">
          <p className="text-sm text-neutral-800">
            {confirmation === 'approved'
              ? 'Approve this exact meeting proposal? It will remain not booked.'
              : 'Reject this meeting proposal? No calendar event will be created.'}
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" className={confirmation === 'approved' ? 'btn-primary text-sm' : 'btn-secondary text-sm'} disabled={busy} onClick={() => onDecision(confirmation)}>
              {busy ? 'SAVING DECISION…' : confirmation === 'approved' ? 'CONFIRM APPROVAL' : 'CONFIRM REJECTION'}
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => setConfirmation(null)}>CANCEL</button>
          </div>
        </div>
      )}

      {canReview && action.status === 'approved' && onRequestDryRun && !displayedExecution && !confirmLiveBooking && !executionError && (
        <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3">
          <p className="text-sm text-neutral-700">Check the saved booking details only. No event or invitation will be created.</p>
          <button type="button" className="btn-secondary text-sm mt-3" disabled={executionBusy} aria-busy={executionBusy || undefined} onClick={onRequestDryRun}>
            {executionBusy ? 'CHECKING BOOKING SETUP…' : 'CHECK BOOKING SETUP'}
          </button>
        </div>
      )}

      {liveUiEnabled && canReview && action.status === 'approved' && onRequestLive &&
        (!displayedExecution || displayedExecution.status === 'provider_disabled') && !confirmLiveBooking && !executionError && (
        <div className="mt-4">
          <p className="text-sm text-neutral-700">A separate confirmed action creates the event in the selected Outlook calendar.</p>
          <button type="button" className="btn-primary text-sm mt-3" disabled={executionBusy} onClick={() => setConfirmLiveBooking(true)}>
          CREATE LIVE CALENDAR EVENT
          </button>
        </div>
      )}

      </div>
      </details>
      {decisionFeedback && (
        <div ref={decisionFeedbackRef} className="m-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900"
          role="status" tabIndex={-1}>
          Proposal {decisionFeedback}. It remains not booked.
        </div>
      )}
      {decisionError && <p ref={decisionErrorRef} className="m-4 text-sm text-red-700" role="alert" tabIndex={-1}>{decisionError}</p>}

      {liveUiEnabled && canReview && action.status === 'approved' && onRequestLive &&
        (!displayedExecution || displayedExecution.status === 'provider_disabled') && confirmLiveBooking && !executionError && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-amber-950" role="group" aria-label="Confirm Outlook calendar booking">
          <p className="text-sm">This will create an event in the workspace’s selected Outlook calendar and may send an invitation to the approved attendee.</p>
          <div className="flex flex-wrap gap-3 mt-3">
            <button type="button" className="btn-primary text-sm" disabled={executionBusy} aria-busy={executionBusy || undefined} onClick={onRequestLive}>
              {executionBusy ? 'CREATING EVENT…' : 'CONFIRM LIVE BOOKING'}
            </button>
            <button type="button" className="btn-ghost text-sm" disabled={executionBusy} onClick={() => setConfirmLiveBooking(false)}>CANCEL</button>
          </div>
        </div>
      )}

      {executionError && <div ref={executionFeedbackRef} className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="alert" tabIndex={-1}>
        <p className="font-semibold">Booking status needs checking</p>
        <p className="mt-1">{executionError}</p>
      </div>}
      {presentation && !executionError && (
        <div ref={executionFeedbackRef} className={`m-4 rounded border p-3 ${presentation.tone}`} role="status" tabIndex={-1}>
          <p className="font-semibold">{presentation.title}</p>
          <p className="text-sm mt-1">{presentation.message}</p>
        </div>
      )}
    </article>
  );
};

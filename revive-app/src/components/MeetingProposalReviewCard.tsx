import React, { useEffect, useRef, useState } from 'react';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';
import type { MeetingExecutionResult } from '@/services/meetingExecutionClient';
import { focusFeedback } from '@/utils/focusFeedback';
import {
  MEETING_OUTCOME_LABELS,
  type MeetingOutcomeType,
} from '@/domain/meetingOutcome';

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
  outcomeBusy?: boolean;
  outcomeError?: string;
  reminderBusy?: boolean;
  reminderError?: string;
  onSaveReminder?: (input: {
    body: string;
    expectedVersion: number;
  }) => Promise<void>;
  onRecordOutcome?: (input: {
    outcomeType: MeetingOutcomeType;
    summary: string;
    occurredAt: string;
    expectedVersion: number;
  }) => Promise<void>;
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

function localDateTimeInput(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
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
  outcomeBusy = false,
  outcomeError,
  reminderBusy = false,
  reminderError,
  onSaveReminder,
  onRecordOutcome,
}) => {
  const [confirmation, setConfirmation] = useState<'approved' | 'rejected' | null>(null);
  const [confirmLiveBooking, setConfirmLiveBooking] = useState(false);
  const [showOutcomeForm, setShowOutcomeForm] = useState(false);
  const [showReminderForm, setShowReminderForm] = useState(false);
  const [reminderBody, setReminderBody] = useState(action.meetingReminderDraft?.body ?? '');
  const [outcomeType, setOutcomeType] = useState<MeetingOutcomeType>(
    action.meetingOutcome?.outcomeType ?? 'held',
  );
  const [outcomeSummary, setOutcomeSummary] = useState(action.meetingOutcome?.summary ?? '');
  const [outcomeOccurredAt, setOutcomeOccurredAt] = useState(
    localDateTimeInput(action.meetingOutcome?.occurredAt ?? new Date().toISOString()),
  );
  const decisionFeedbackRef = useRef<HTMLDivElement>(null);
  const decisionErrorRef = useRef<HTMLParagraphElement>(null);
  const executionFeedbackRef = useRef<HTMLDivElement>(null);
  const liveUiEnabled = import.meta.env.VITE_REV_MEETING_LIVE_UI_ENABLED === 'true';
  const proposal = action.meetingProposal;
  const displayedExecution = executionResult ?? action.meetingDryRun;
  const presentation = displayedExecution ? executionPresentation(displayedExecution) : undefined;
  const reminderEditingAvailable = !action.meetingReminderUnavailable
    && !action.meetingOutcomeUnavailable
    && displayedExecution?.status === 'event_created'
    && Date.parse(proposal?.startAt ?? '') > Date.now()
    && !action.meetingOutcome;

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

      <section className="mt-4 border-t border-neutral-200 pt-4" aria-label="Meeting reminder draft">
        <p className="text-sm font-medium text-neutral-900">Meeting reminder draft</p>
        {action.meetingReminderUnavailable ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            {action.meetingReminderUnavailable}
          </p>
        ) : action.meetingReminderDraft ? (
          <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            <p className="whitespace-pre-wrap break-words">{action.meetingReminderDraft.body}</p>
            <p className="mt-2 text-xs font-medium text-neutral-600">Reminder draft saved. Delivery is not enabled.</p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-neutral-600">No reminder draft has been prepared.</p>
        )}
        {canReview && action.meetingProposalId && reminderEditingAvailable && onSaveReminder && !showReminderForm && (
          <button type="button" className="btn-secondary mt-3 text-sm" disabled={reminderBusy} onClick={() => setShowReminderForm(true)}>
            {action.meetingReminderDraft ? 'Correct reminder draft' : 'Prepare reminder draft'}
          </button>
        )}
        {!action.meetingReminderUnavailable && !action.meetingOutcomeUnavailable
          && action.meetingReminderDraft && !reminderEditingAvailable && (
          <p className="mt-2 text-xs text-neutral-500">Editing is unavailable after the meeting starts or an explicit outcome is recorded.</p>
        )}
        {!action.meetingReminderUnavailable && action.meetingOutcomeUnavailable && (
          <p className="mt-2 text-xs text-amber-800">
            Reminder preparation and correction are unavailable until meeting outcome storage can confirm that no outcome exists.
          </p>
        )}
        {showReminderForm && (
          <form className="mt-3 grid gap-3 rounded border border-neutral-200 bg-neutral-50 p-3" onSubmit={(event) => {
            event.preventDefault();
            void onSaveReminder?.({
              body: reminderBody.trim(),
              expectedVersion: action.meetingReminderDraft?.version ?? 0,
            }).then(() => setShowReminderForm(false)).catch(() => undefined);
          }}>
            <label className="grid gap-1 text-sm font-medium text-neutral-800">
              Reminder body
              <textarea className="input-field min-h-24 resize-y bg-white" required maxLength={2000}
                value={reminderBody} onChange={(event) => setReminderBody(event.target.value)}
                placeholder="Prepare plain-text reminder wording. Nothing will be delivered." />
            </label>
            <p className="text-xs text-neutral-600">This is a manual, channel-neutral draft. Delivery is not enabled.</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary text-sm" disabled={reminderBusy || !reminderBody.trim()}>
                {reminderBusy ? 'SAVING DRAFT…' : action.meetingReminderDraft ? 'SAVE CORRECTION' : 'SAVE REMINDER DRAFT'}
              </button>
              <button type="button" className="btn-ghost text-sm" disabled={reminderBusy} onClick={() => setShowReminderForm(false)}>CANCEL</button>
            </div>
          </form>
        )}
        {reminderError && <p className="mt-3 text-sm text-red-700" role="alert">{reminderError}</p>}
      </section>

      <section className="mt-4 border-t border-neutral-200 pt-4" aria-label="Meeting outcome">
        <p className="text-sm font-medium text-neutral-900">Meeting outcome</p>
        {action.meetingOutcomeUnavailable ? (
          <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            {action.meetingOutcomeUnavailable}
          </p>
        ) : action.meetingOutcome ? (
          <div className="mt-2 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700">
            <p><strong>{MEETING_OUTCOME_LABELS[action.meetingOutcome.outcomeType]}</strong> — recorded {new Date(action.meetingOutcome.occurredAt).toLocaleString('en-GB')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{action.meetingOutcome.summary}</p>
            <p className="mt-2 text-xs text-neutral-500">This manually recorded outcome is separate from booking and RSVP status.</p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-neutral-600">No meeting outcome has been recorded.</p>
        )}
        {!action.meetingOutcomeUnavailable && canReview && action.meetingProposalId
          && ['approved', 'completed'].includes(action.status) && onRecordOutcome && !showOutcomeForm && (
          <button type="button" className="btn-secondary mt-3 text-sm" disabled={outcomeBusy} onClick={() => setShowOutcomeForm(true)}>
            {action.meetingOutcome ? 'Correct meeting outcome' : 'Record meeting outcome'}
          </button>
        )}
        {!action.meetingOutcomeUnavailable && showOutcomeForm && (
          <form className="mt-3 grid gap-3 rounded border border-neutral-200 bg-neutral-50 p-3" onSubmit={(event) => {
            event.preventDefault();
            void onRecordOutcome?.({
              outcomeType,
              summary: outcomeSummary.trim(),
              occurredAt: new Date(outcomeOccurredAt).toISOString(),
              expectedVersion: action.meetingOutcome?.version ?? 0,
            }).then(() => setShowOutcomeForm(false)).catch(() => undefined);
          }}>
            <label className="grid gap-1 text-sm font-medium text-neutral-800">
              Outcome
              <select className="input-field bg-white" value={outcomeType} onChange={(event) => setOutcomeType(event.target.value as MeetingOutcomeType)}>
                <option value="held">Held — the meeting took place</option>
                <option value="no_show">No-show — an expected attendee did not attend</option>
                <option value="cancelled">Cancelled — the meeting was cancelled</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-neutral-800">
              When this outcome occurred
              <input className="input-field bg-white" type="datetime-local" required max={localDateTimeInput(new Date().toISOString())}
                value={outcomeOccurredAt} onChange={(event) => setOutcomeOccurredAt(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-medium text-neutral-800">
              Summary
              <textarea className="input-field min-h-24 resize-y bg-white" required maxLength={1000}
                value={outcomeSummary} onChange={(event) => setOutcomeSummary(event.target.value)}
                placeholder="Record commercial results and next steps without inferring a sale, revenue or goal progress." />
            </label>
            {outcomeType === 'cancelled' && (
              <p className="text-sm text-amber-800">Recording “Cancelled” here does not cancel the Outlook event or notify anyone.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="btn-primary text-sm" disabled={outcomeBusy || !outcomeSummary.trim() || !outcomeOccurredAt}>
                {outcomeBusy ? 'SAVING OUTCOME…' : action.meetingOutcome ? 'SAVE CORRECTION' : 'SAVE OUTCOME'}
              </button>
              <button type="button" className="btn-ghost text-sm" disabled={outcomeBusy} onClick={() => setShowOutcomeForm(false)}>CANCEL</button>
            </div>
          </form>
        )}
        {outcomeError && <p className="mt-3 text-sm text-red-700" role="alert">{outcomeError}</p>}
      </section>

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

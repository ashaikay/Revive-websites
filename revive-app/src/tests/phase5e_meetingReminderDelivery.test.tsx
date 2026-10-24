// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {MeetingProposalReviewCard} from '@/components/MeetingProposalReviewCard';
import type {LivePendingAction} from '@/data/supabasePreparedWorkRepository';
import type {MeetingReminderDelivery} from '@/domain/meetingReminderDelivery';
import {
 clearMeetingReminderSend,
 rememberMeetingReminderSend,
 restoreMeetingReminderSend,
 submitMeetingReminderDelivery,
} from '@/services/meetingReminderDeliveryService';

const workspaceId='11111111-1111-4111-8111-111111111111';
const userId='22222222-2222-4222-8222-222222222222';
const proposalId='33333333-3333-4333-8333-333333333333';
const draftId='44444444-4444-4444-8444-444444444444';
const deliveryId='55555555-5555-4555-8555-555555555555';
const requestId='66666666-6666-4666-8666-666666666666';

const delivery:MeetingReminderDelivery={
 id:deliveryId,workspaceId,meetingProposalId:proposalId,reminderDraftId:draftId,
 approvedDraftVersion:2,status:'approved_not_sent',approvedByUserId:userId,
 approvedAt:'2026-10-09T15:00:00.000Z',version:1,
 createdAt:'2026-10-09T15:00:00.000Z',updatedAt:'2026-10-09T15:00:00.000Z',
};

const action:LivePendingAction={
 id:'77777777-7777-4777-8777-777777777777',workspaceId,actionType:'meeting_proposal',
 title:'Discovery call',description:'Meeting proposal.',requiresApproval:true,status:'completed',
 executionStatus:'succeeded',proposedAt:'2026-10-09T09:00:00.000Z',actionVersion:1,
 approvalId:'88888888-8888-4888-8888-888888888888',approvalActionVersion:1,
 approvalActionFingerprint:'a'.repeat(64),meetingProposalId:proposalId,
 meetingProposal:{title:'Discovery call',attendeeEmail:'customer@example.test',startAt:'2099-10-10T09:00:00.000Z',endAt:'2099-10-10T09:30:00.000Z',timezone:'Europe/London',meetingMethod:'online',locationDetails:'',notes:''},
 meetingDryRun:{status:'event_created',executionId:'99999999-9999-4999-8999-999999999999',providerOutcome:'accepted_by_provider',providerInvoked:true,eventCreated:true,invitationSent:null},
 meetingReminderDraft:{id:draftId,workspaceId,meetingProposalId:proposalId,body:'Please remember our meeting.',preparedByUserId:userId,version:2,createdAt:'2026-10-09T14:00:00.000Z',updatedAt:'2026-10-09T14:00:00.000Z'},
};

function mount(overrides:Partial<Parameters<typeof MeetingProposalReviewCard>[0]>={}){
 render(<MeetingProposalReviewCard action={action} canReview busy={false} onDecision={vi.fn()} {...overrides}/>);
 fireEvent.click(screen.getByText('View details and actions'));
}

beforeEach(()=>window.sessionStorage.clear());
afterEach(cleanup);

describe('manual meeting reminder email delivery',()=>{
 it('keeps the dedicated capability and provider gate disabled by default',()=>{
  const source=readFileSync(join(process.cwd(),'supabase','functions','rev-meeting-reminder-deliver','index.ts'),'utf8');
  const migration=readFileSync(join(process.cwd(),'supabase','migrations','20261009170000_rev_meeting_reminder_delivery.sql'),'utf8');
  expect(source).toContain("SEND_MEETING_REMINDER_EMAIL_CAPABILITY = 'SEND_MEETING_REMINDER_EMAIL'");
  expect(source).toContain('const PROVIDER_EXECUTION_ENABLED = false');
  expect(migration).toContain("capability = 'SEND_MEETING_REMINDER_EMAIL'");
  expect(migration).toContain('unique (workspace_id, meeting_proposal_id)');
  expect(migration).toContain('meeting_reminder_delivery.provider_attempt_claimed');
 });

 it('requires exact-draft approval before presenting separate sending consent',()=>{
  const onApprove=vi.fn().mockResolvedValue(undefined);
  mount({onApproveReminderDelivery:onApprove});
  fireEvent.click(screen.getByRole('button',{name:'APPROVE REMINDER FOR EMAIL'}));
  const confirm=screen.getByRole('group',{name:'Confirm reminder approval'});
  expect(confirm).toHaveTextContent('Approval does not send anything');
  expect(confirm).toHaveTextContent('expire if the draft is corrected');
  fireEvent.click(within(confirm).getByRole('button',{name:'CONFIRM APPROVAL — NOT SENT'}));
  expect(onApprove).toHaveBeenCalledOnce();
 });

 it('uses a second explicit consent action for an approved current draft',()=>{
  const onSend=vi.fn().mockResolvedValue(undefined);
  mount({action:{...action,meetingReminderDelivery:delivery},onSendReminderDelivery:onSend});
  expect(screen.getByText('Approved — not sent.')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'SEND EMAIL REMINDER'}));
  const consent=screen.getByRole('group',{name:'Confirm reminder sending consent'});
  expect(consent).toHaveTextContent('Calendar consent does not authorize this email');
  expect(consent).toHaveTextContent('At most one provider attempt is allowed');
  fireEvent.click(within(consent).getByRole('button',{name:'CONFIRM CONSENT AND SEND EMAIL'}));
  expect(onSend).toHaveBeenCalledWith(false);
 });

 it('invalidates approval after correction and blocks another attempt after a claim',()=>{
  const {unmount}=render(<MeetingProposalReviewCard action={{...action,meetingReminderDelivery:{...delivery,approvedDraftVersion:1}}} canReview busy={false} onDecision={vi.fn()} onApproveReminderDelivery={vi.fn()}/>);
  fireEvent.click(screen.getByText('View details and actions'));
  expect(screen.getByText(/Approval expired/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'SEND EMAIL REMINDER'})).toBeNull();
  unmount();

  mount({action:{...action,meetingReminderDelivery:{...delivery,status:'provider_outcome_unknown',sendAuthorizedByUserId:userId,sendAuthorizedAt:'2026-10-09T15:05:00.000Z',providerKey:'microsoft_graph'}},onSendReminderDelivery:vi.fn()});
  expect(screen.getByText(/Send outcome unresolved — do not retry/)).toBeVisible();
  expect(screen.queryByRole('button',{name:/SEND|RETRY/})).toBeNull();
 });

 it('displays provider acceptance without claiming delivery confirmation',()=>{
  mount({action:{...action,meetingReminderDelivery:{...delivery,status:'accepted_by_provider',sendAuthorizedByUserId:userId,sendAuthorizedAt:'2026-10-09T15:05:00.000Z',providerKey:'microsoft_graph'}}});
  expect(screen.getByText('Accepted by provider — delivery not confirmed.')).toBeVisible();
  expect(screen.queryByText(/delivered/i)).toBeNull();
 });

 it('keeps the saved draft visible when delivery storage is unavailable',()=>{
  mount({action:{...action,meetingReminderDeliveryUnavailable:'Reminder email delivery is unavailable because delivery storage has not been deployed. Reminder drafts and other REV information remain available.'}});
  expect(screen.getByText('Please remember our meeting.')).toBeVisible();
  expect(screen.getByText(/delivery storage has not been deployed/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'SEND EMAIL REMINDER'})).toBeNull();
 });

 it('retains and restores the exact pre-claim request and validates the trusted response',async()=>{
  const request={operation:'send' as const,workspaceId,requestId,meetingProposalId:proposalId,sendConsent:true as const};
  rememberMeetingReminderSend(window.sessionStorage,userId,request);
  expect(restoreMeetingReminderSend(window.sessionStorage,workspaceId,userId,proposalId)).toEqual(request);
  const result=await submitMeetingReminderDelivery(request,vi.fn().mockResolvedValue({status:200,data:{
   status:'provider_disabled',displayStatus:'Email sending disabled — nothing sent',
   providerInvoked:false,acceptedByProvider:false,deliveryConfirmed:false,automaticRetryAllowed:true,
  }}));
  expect(result.status).toBe('provider_disabled');
  clearMeetingReminderSend(window.sessionStorage,workspaceId,userId,proposalId);
  expect(restoreMeetingReminderSend(window.sessionStorage,workspaceId,userId,proposalId)).toBeNull();
 });
});

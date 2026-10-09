// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {AnnualLeaveHistory} from '@/components/AnnualLeaveView';
import type {AnnualLeaveAbsence,LegacyAnnualLeave} from '@/services/annualLeave';

const workerId='11111111-1111-4111-8111-111111111111';
const absence:AnnualLeaveAbsence={absenceId:'22222222-2222-4222-8222-222222222222',unavailabilityId:'33333333-3333-4333-8333-333333333333',workerId,startAt:'2026-10-05T08:00:00.000Z',endAt:'2026-10-05T12:00:00.000Z',timezone:'Europe/London',totalDeductionMinutes:240,status:'confirmed',version:1,accountIds:['44444444-4444-4444-8444-444444444444'],createdAt:'2026-10-04T12:00:00.000Z',cancelledAt:null};
const legacy:LegacyAnnualLeave={unavailabilityId:'55555555-5555-4555-8555-555555555555',workerId,startAt:'2025-06-01T08:00:00.000Z',endAt:'2025-06-01T16:00:00.000Z',status:'active',version:2};

afterEach(cleanup);

describe('Annual Leave cancellation controls',()=>{
 it('confirms the exact balance reversal before cancelling accounted leave',()=>{
  const onCancel=vi.fn();
  render(<AnnualLeaveHistory absences={[absence]} legacy={[]} legacyDisplayTimezone="UTC" disabled={false} onCancel={onCancel} onCancelLegacy={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel leave'}));
  const confirmation=screen.getByRole('group',{name:'Confirm annual leave cancellation'});
  expect(confirmation).toHaveTextContent('leave the active planner');
  expect(confirmation).toHaveTextContent('remain in history');
  expect(confirmation).toHaveTextContent('exact recorded balance deduction will be reversed');
  expect(onCancel).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole('button',{name:'Confirm cancellation'}));
  expect(onCancel).toHaveBeenCalledWith(absence);
 });

 it('states that cancelling older leave does not change Annual Leave balances',()=>{
  const onCancelLegacy=vi.fn();
  render(<AnnualLeaveHistory absences={[]} legacy={[legacy]} legacyDisplayTimezone="UTC" disabled={false} onCancel={vi.fn()} onCancelLegacy={onCancelLegacy}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel older leave'}));
  const confirmation=screen.getByRole('group',{name:'Confirm older leave cancellation'});
  expect(confirmation).toHaveTextContent('remain in history');
  expect(confirmation).toHaveTextContent('Annual Leave balances will not change');
  fireEvent.click(within(confirmation).getByRole('button',{name:'Confirm cancellation'}));
  expect(onCancelLegacy).toHaveBeenCalledWith(legacy);
 });
});

import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {AnnualLeaveBalance,AnnualLeaveHistory} from '@/components/AnnualLeaveView';
import type {AnnualLeaveAbsence,AnnualLeaveAccount,LegacyAnnualLeave} from '@/services/annualLeave';

const account:AnnualLeaveAccount={accountId:'11111111-1111-4111-8111-111111111111',workerId:'22222222-2222-4222-8222-222222222222',leaveYearStart:'2026-01-01',leaveYearEndExclusive:'2027-01-01',configuredAllowanceMinutes:12600,adjustmentTotalMinutes:450,recordedLeaveMinutes:900,remainingMinutes:12150,hoursPerDayMinutes:450,bankHolidayTreatment:'additional',version:3};
const absence:AnnualLeaveAbsence={absenceId:'33333333-3333-4333-8333-333333333333',unavailabilityId:'44444444-4444-4444-8444-444444444444',workerId:account.workerId,startAt:'2026-10-05T08:00:00.000Z',endAt:'2026-10-05T12:00:00.000Z',timezone:'Europe/London',totalDeductionMinutes:240,status:'confirmed',version:1,accountIds:[account.accountId],createdAt:'2026-10-04T12:00:00.000Z',cancelledAt:null};
const legacy:LegacyAnnualLeave={unavailabilityId:'55555555-5555-4555-8555-555555555555',workerId:account.workerId,startAt:'2025-06-01T08:00:00.000Z',endAt:'2025-06-01T16:00:00.000Z',status:'active',version:2};

describe('Annual Leave Stage 3 presentation',()=>{
 it('shows simple day-first balances using the saved working-day conversion',()=>{
  const markup=renderToStaticMarkup(<AnnualLeaveBalance account={account}/>);
  expect(markup).toContain('Allowance');expect(markup).toContain('29 days at 7h 30m per day');expect(markup).toContain('217h 30m');expect(markup).toContain('Used');expect(markup).toContain('2 days at 7h 30m per day');expect(markup).toContain('15h 00m');expect(markup).toContain('Remaining');expect(markup).toContain('27 days at 7h 30m per day');expect(markup).toContain('202h 30m');expect(markup.indexOf('29 days')).toBeLessThan(markup.indexOf('217h 30m'));expect(markup).not.toContain('Adjustments');expect(markup).not.toContain('Net leave recorded');
 });
 it('uses plain cancellation labels and explicit stored or fallback timezones',()=>{
  const browserLocal=vi.spyOn(Date.prototype,'toLocaleString').mockReturnValue('BROWSER LOCAL TIME'),onCancel=vi.fn(),onCancelLegacy=vi.fn(),markup=renderToStaticMarkup(<AnnualLeaveHistory absences={[absence]} legacy={[legacy]} legacyDisplayTimezone="America/New_York" disabled={false} onCancel={onCancel} onCancelLegacy={onCancelLegacy}/>);
  expect(markup).toContain('Annual leave');expect(markup).toContain('05/10/2026, 09:00 to 05/10/2026, 13:00 (Europe/London)');expect(markup).toContain('Leave used: 4h 00m');expect(markup).toContain('Cancel leave');expect(markup).toContain('Older leave (not included in the balance)');expect(markup).toContain('01/06/2025, 04:00 to 01/06/2025, 12:00 (shown in America/New_York; the original timezone was not saved)');expect(markup).toContain('Cancel older leave');expect(markup).not.toContain('BROWSER LOCAL TIME');expect(markup).not.toMatch(/employee request|approval required|authoritative|exact accounting|posting|revision/i);browserLocal.mockRestore();
 });
});

import {useEffect, useRef, useState} from 'react';
import {supabaseClient} from '@/data/supabaseClient';
import {localLeaveToUtc} from '@/services/workerUnavailability';
import {formatSchedulingDate} from '@/services/schedulingDisplay';
import {
  clearAnnualLeaveAttempt,
  createAnnualLeaveScopeGuard,
  expectedAccountsForDates,
  formatAnnualLeaveInstant,
  formatLeaveDayTotal,
  formatAnnualLeaveRange,
  formatAnnualLeaveAbsenceDays,
  formatLeaveMinutes,
  invalidAnnualLeaveAttemptMessage,
  loadAnnualLeavePages,
  loadAnnualLeaveWorkspace,
  rememberAnnualLeaveAttempt,
  restoreAnnualLeaveAttempt,
  submitAnnualLeaveAttempt,
  AnnualLeaveRefused,
  type AnnualLeaveAbsence,
  type AnnualLeaveAccount,
  type AnnualLeaveAttempt,
  type AnnualLeaveOperation,
  type AnnualLeaveTable,
  type AnnualLeaveWorkspaceModel,
  type LegacyAnnualLeave,
} from '@/services/annualLeave';
import type {Worker} from '@/services/schedulingWorkers';
import {OfficialBankHolidayImport} from './OfficialBankHolidayImport';

interface Drafts {
  allowanceUnit: 'hours' | 'days';
  allowanceValue: string;
  workingDayHours: string;
  leaveYearStart: string;
  holidayTreatment: 'included' | 'additional';
  adjustmentUnit: 'hours' | 'days';
  adjustmentValue: string;
  adjustmentReason: string;
  calendarName: string;
  calendarRegion: string;
  calendarId: string;
  calendarYear: string;
  holidayDate: string;
  holidayName: string;
  recordMode: 'full' | 'partial';
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

const currentYear = new Date().getFullYear();
const initialDrafts = (): Drafts => ({
  allowanceUnit: 'days',
  allowanceValue: '28',
  workingDayHours: '7.5',
  leaveYearStart: `${currentYear}-01-01`,
  holidayTreatment: 'included',
  adjustmentUnit: 'days',
  adjustmentValue: '',
  adjustmentReason: '',
  calendarName: '',
  calendarRegion: 'GB-ENG',
  calendarId: '',
  calendarYear: String(currentYear),
  holidayDate: '',
  holidayName: '',
  recordMode: 'full',
  startDate: '',
  endDate: '',
  startTime: '09:00',
  endTime: '17:00',
});

const addDay = (value: string) =>
  new Date(Date.parse(`${value}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
const subtractDay = (value: string) =>
  new Date(Date.parse(`${value}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const fieldClass =
  'input-field bg-white text-neutral-900 disabled:bg-neutral-100 disabled:text-neutral-500';
const labelClass = 'grid gap-1 text-sm font-medium text-neutral-800';

const invoke = async (name: string, body: Record<string, unknown>) => {
  if (!supabaseClient) throw Error('Unavailable');
  const {data, error} = await supabaseClient.functions.invoke(name, {body});
  if (error) {
    const context = (error as {context?: unknown}).context;
    if (context instanceof Response && context.status === 409) {
      return {status: 409, data: await context.clone().json()};
    }
    throw Error('Uncertain result');
  }
  return {status: 200, data};
};

function accountLabel(account: AnnualLeaveAccount) {
  return `${formatSchedulingDate(account.leaveYearStart)} to ${formatSchedulingDate(subtractDay(account.leaveYearEndExclusive))}`;
}

function exactMinutes(value: string, unit: 'hours' | 'days', minutesPerDay: number) {
  const amount = Number(value);
  const minutes = unit === 'hours' ? amount * 60 : amount * minutesPerDay;
  if (!Number.isFinite(amount) || !Number.isSafeInteger(minutes)) {
    throw Error('Enter a value that converts to whole minutes.');
  }
  return minutes;
}

function LeaveAmount({minutes, minutesPerDay}: {minutes: number; minutesPerDay: number}) {
  return (
    <>
      <p className="text-lg font-semibold">{formatLeaveDayTotal(minutes, minutesPerDay)}</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer">View calculation</summary>
        <p>{formatLeaveMinutes(minutes)} at {formatLeaveMinutes(minutesPerDay)} per day.</p>
      </details>
    </>
  );
}

export function AnnualLeaveBalance({account}: {account: AnnualLeaveAccount}) {
  const allowanceMinutes = account.configuredAllowanceMinutes + account.adjustmentTotalMinutes;
  return (
    <section aria-label="Leave balance" className="grid gap-3 sm:grid-cols-3">
      <div className="card p-4">
        <strong className="text-sm text-neutral-600">Allowance</strong>
        <LeaveAmount minutes={allowanceMinutes} minutesPerDay={account.hoursPerDayMinutes} />
        {account.adjustmentTotalMinutes !== 0 && <small>Includes saved allowance changes.</small>}
      </div>
      <div className="card p-4">
        <strong className="text-sm text-neutral-600">Used</strong>
        <LeaveAmount minutes={account.recordedLeaveMinutes} minutesPerDay={account.hoursPerDayMinutes} />
      </div>
      <div className="card p-4">
        <strong className="text-sm text-neutral-600">Remaining</strong>
        <LeaveAmount minutes={account.remainingMinutes} minutesPerDay={account.hoursPerDayMinutes} />
      </div>
    </section>
  );
}

export function AnnualLeaveHistory({
  absences,
  accounts = [],
  legacy,
  legacyDisplayTimezone,
  onCancel,
  onCancelLegacy,
  disabled,
}: {
  absences: AnnualLeaveAbsence[];
  accounts?: AnnualLeaveAccount[];
  legacy: LegacyAnnualLeave[];
  legacyDisplayTimezone: string;
  onCancel: (absence: AnnualLeaveAbsence) => void;
  onCancelLegacy: (leave: LegacyAnnualLeave) => void;
  disabled: boolean;
}) {
  if (absences.length === 0 && legacy.length === 0) return <p>No leave has been recorded for this worker.</p>;
  return (
    <ul className="grid gap-3">
      {absences.map(absence => (
        <li className="card p-3" key={absence.absenceId}>
          <strong>{absence.status === 'confirmed' ? 'Annual leave' : 'Cancelled annual leave'}</strong>
          <p>
            {formatAnnualLeaveRange(absence.startAt, absence.endAt, absence.timezone)} ({absence.timezone})
          </p>
          <p>{absence.status === 'confirmed' ? 'Leave used' : 'Original leave amount'}: {formatAnnualLeaveAbsenceDays(absence, accounts)}</p>
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer">View calculation</summary>
            <p>{formatLeaveMinutes(absence.totalDeductionMinutes)} in the original leave record.</p>
          </details>
          {absence.status === 'confirmed' && (
            <button className="btn-secondary mt-2" disabled={disabled} onClick={() => onCancel(absence)}>
              Cancel leave
            </button>
          )}
        </li>
      ))}
      {legacy.map(leave => (
        <li className="card p-3" key={leave.unavailabilityId}>
          <strong>Older leave (not included in the balance)</strong>
          <p>
            {formatAnnualLeaveInstant(leave.startAt, legacyDisplayTimezone)} to{' '}
            {formatAnnualLeaveInstant(leave.endAt, legacyDisplayTimezone)} (shown in {legacyDisplayTimezone};
            the original timezone was not saved)
          </p>
          <p>Status: {leave.status === 'active' ? 'Recorded' : 'Cancelled'}</p>
          {leave.status === 'active' && (
            <button className="btn-secondary mt-2" disabled={disabled} onClick={() => onCancelLegacy(leave)}>
              Cancel older leave
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AnnualLeaveView({
  workspaceId,
  userId,
  workers,
  disabled: parentDisabled = false,
  retryDisabled = parentDisabled,
  parentDisabledReason = '',
}: {
  workspaceId: string;
  userId: string;
  workers: Worker[];
  disabled?: boolean;
  retryDisabled?: boolean;
  parentDisabledReason?: string;
}) {
  const defaultWorkerId = workers.find(worker => worker.active)?.workerId ?? workers[0]?.workerId ?? '';
  const scope = `${workspaceId}:${userId}`;
  const [workerId, setWorkerId] = useState(defaultWorkerId);
  const [model, setModel] = useState<AnnualLeaveWorkspaceModel | null>(null);
  const [yearStart, setYearStart] = useState('');
  const [drafts, setDrafts] = useState<Drafts>(initialDrafts);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<AnnualLeaveAttempt | null>(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupEditing, setSetupEditing] = useState(false);
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [holidaysEditing, setHolidaysEditing] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const loadSequence = useRef(0);
  const locked = useRef(false);
  const scopeGuard = useRef(createAnnualLeaveScopeGuard(scope));
  const selectedWorkerIdRef = useRef(workerId);

  scopeGuard.current.update(scope);
  selectedWorkerIdRef.current = workerId;

  const read = async (
    table: AnnualLeaveTable,
    columns: string,
    ws: string,
    worker: string,
    accountIds?: string[],
  ) => {
    const client = supabaseClient;
    if (!client) throw Error('Unavailable');
    if (table === 'annual_leave_postings' && !accountIds?.length) return [];
    return loadAnnualLeavePages(table, async (from, to, orderColumns) => {
      let query = client.from(table).select(columns).eq('workspace_id', ws);
      if (
        [
          'annual_leave_accounts',
          'annual_leave_adjustments',
          'annual_leave_absences',
          'annual_leave_calculation_segments',
          'annual_leave_worker_calendars',
          'scheduling_worker_patterns',
          'scheduling_worker_unavailability',
        ].includes(table)
      ) {
        query = query.eq('worker_id', worker);
      }
      if (table === 'annual_leave_policies') query = query.or(`worker_id.is.null,worker_id.eq.${worker}`);
      if (table === 'annual_leave_postings') query = query.in('account_id', accountIds!);
      if (table === 'scheduling_worker_unavailability') query = query.eq('category', 'leave');
      for (const column of orderColumns) query = query.order(column, {ascending: true});
      const {data, error} = await query.range(from, to);
      if (error) throw Error('Annual leave page unavailable; no partial data shown.');
      return data;
    });
  };

  const load = async (targetWorker = workerId) => {
    if (!targetWorker) return false;
    const sequence = ++loadSequence.current;
    const token = scopeGuard.current.capture();
    setRefreshing(true);
    setMessage('Loading leave...');
    try {
      const value = await loadAnnualLeaveWorkspace(workspaceId, targetWorker, read);
      if (
        !scopeGuard.current.isCurrent(token) ||
        sequence !== loadSequence.current ||
        targetWorker !== selectedWorkerIdRef.current
      ) {
        return false;
      }
      setModel(value);
      setYearStart(current =>
        value.accounts.some(account => account.leaveYearStart === current)
          ? current
          : value.accounts[0]?.leaveYearStart ?? '',
      );
      const workerPolicy = value.policies
        .filter(policy => policy.workerId === targetWorker)
        .sort((a, b) => b.version - a.version)[0];
      const workspacePolicy = value.policies
        .filter(policy => policy.workerId === null)
        .sort((a, b) => b.version - a.version)[0];
      const displayedPolicy = workerPolicy ?? workspacePolicy;
      const displayedYearStart =
        value.accounts[0]?.leaveYearStart ??
        (displayedPolicy
          ? `${displayedPolicy.effectiveFromLeaveYear}-${String(displayedPolicy.leaveYearStartMonth).padStart(2, '0')}-${String(displayedPolicy.leaveYearStartDay).padStart(2, '0')}`
          : null);
      setDrafts(current => ({
        ...current,
        allowanceUnit: displayedPolicy?.allowanceInputUnit ?? current.allowanceUnit,
        allowanceValue: displayedPolicy ? String(displayedPolicy.allowanceInputValue) : current.allowanceValue,
        workingDayHours: displayedPolicy
          ? String(displayedPolicy.hoursPerDayMinutes / 60)
          : current.workingDayHours,
        leaveYearStart: displayedYearStart ?? current.leaveYearStart,
        holidayTreatment: displayedPolicy?.bankHolidayTreatment ?? current.holidayTreatment,
        calendarId:
          value.assignedCalendarId ??
          value.calendars.find(calendar => calendar.status === 'active')?.calendarId ??
          current.calendarId,
        calendarYear: displayedYearStart?.slice(0, 4) ?? current.calendarYear,
      }));
      setMessage('');
      return true;
    } catch (error) {
      if (scopeGuard.current.isCurrent(token) && sequence === loadSequence.current) {
        setModel(null);
        const detail =
          error instanceof Error &&
          (error.message.includes('no partial data shown') || error.message.includes('safety limit'))
            ? error.message
            : "Leave details couldn't be loaded completely.";
        setMessage(`${detail} No leave changes can be made until you refresh successfully.`);
      }
      return false;
    } finally {
      if (scopeGuard.current.isCurrent(token) && sequence === loadSequence.current) setRefreshing(false);
    }
  };

  useEffect(() => {
    scopeGuard.current.activate();
    return () => scopeGuard.current.deactivate();
  }, []);

  useEffect(() => {
    loadSequence.current++;
    locked.current = false;
    setPending(null);
    setStorageBlocked(false);
    setModel(null);
    setYearStart('');
    setDrafts(initialDrafts());
    setBusy(false);
    setRefreshing(false);
    setSettingsOpen(false);
    setSetupEditing(false);
    setAdjustmentsOpen(false);
    setHolidaysEditing(false);
    setImportLoading(false);
    setMessage('');
    let nextWorker = defaultWorkerId;
    try {
      const saved = restoreAnnualLeaveAttempt(window.sessionStorage, workspaceId, userId);
      if (saved) {
        setPending(saved);
        nextWorker = saved.workerId;
        setMessage(
          'A previous change may have completed. Retry the same change to check safely before making another one.',
        );
      }
    } catch {
      setStorageBlocked(true);
      setMessage('Saved recovery information could not be read. Contact support before making changes.');
    }
    setWorkerId(nextWorker);
  }, [workspaceId, userId]);

  useEffect(() => {
    setModel(null);
    setImportLoading(false);
    if (workerId) void load(workerId);
  }, [workspaceId, userId, workerId]);

  const run = async (operation: AnnualLeaveOperation, body: Record<string, unknown>, retry = false) => {
    if (
      locked.current ||
      importLoading ||
      refreshing ||
      storageBlocked ||
      !workerId ||
      (retry ? retryDisabled : parentDisabled) ||
      (!retry && !model)
    ) {
      return;
    }
    const token = scopeGuard.current.capture();
    const attemptUserId = userId;
    locked.current = true;
    setBusy(true);
    let attempt = pending;
    try {
      if (!attempt) {
        if (retry) throw Error('Pending request unavailable');
        const requestId = crypto.randomUUID();
        attempt = {
          operation,
          workspaceId,
          workerId,
          requestId,
          body: {...body, workspaceId, requestId},
        };
        rememberAnnualLeaveAttempt(window.sessionStorage, userId, attempt);
        setPending(attempt);
      }
      const submittedAttempt = attempt;
      await submitAnnualLeaveAttempt(submittedAttempt, invoke);
      if (!scopeGuard.current.isCurrent(token)) return;
      clearAnnualLeaveAttempt(window.sessionStorage, submittedAttempt.workspaceId, attemptUserId);
      setPending(null);
      if (['record', 'cancel', 'legacy_cancel'].includes(submittedAttempt.operation)) {
        window.dispatchEvent(new Event('rev-scheduling-changed'));
      }
      const success =
        submittedAttempt.operation === 'record'
          ? 'Leave added. The balance and weekly planner have been updated.'
          : submittedAttempt.operation === 'cancel'
            ? 'Leave cancelled. The balance and weekly planner have been updated.'
            : submittedAttempt.operation === 'legacy_cancel'
              ? 'Older leave cancelled. The weekly planner has been updated and the balance is unchanged.'
              : submittedAttempt.operation === 'import'
                ? 'Official holidays imported and the reviewed year confirmed. Existing leave and balances are unchanged.'
              : 'This setup step is complete. Continue with the next step when ready.';
      const reloaded = await load(submittedAttempt.workerId);
      if (scopeGuard.current.isCurrent(token)) {
        setMessage(reloaded ? success : `${success} Select Refresh to reload the latest leave details.`);
      }
    } catch (error) {
      if (!scopeGuard.current.isCurrent(token)) return;
      if (error instanceof AnnualLeaveRefused && attempt) {
        clearAnnualLeaveAttempt(window.sessionStorage, attempt.workspaceId, attemptUserId);
        setPending(null);
        const reloaded = await load(workerId);
        if (scopeGuard.current.isCurrent(token)) {
          setMessage(reloaded ? error.message : `${error.message} Select Refresh to reload the latest leave details.`);
        }
      } else {
        setMessage(
          'We could not confirm what happened. Your original change is saved; use Retry same change before doing anything else.',
        );
      }
    } finally {
      if (scopeGuard.current.isCurrent(token)) {
        locked.current = false;
        setBusy(false);
      }
    }
  };

  const refresh = async () => {
    if (locked.current || busy || refreshing || !workerId) return;
    const token = scopeGuard.current.capture();
    const reloaded = await load(workerId);
    if (reloaded && scopeGuard.current.isCurrent(token)) {
      setMessage('Leave details refreshed. No saved change was resubmitted.');
    }
  };

  const account = model?.accounts.find(value => value.leaveYearStart === yearStart) ?? null;
  const selectedCalendar = model?.calendars.find(value => value.calendarId === drafts.calendarId) ?? null;
  const selectedWorker = workers.find(worker => worker.workerId === workerId) ?? null;
  const workerPolicy =
    model?.policies
      .filter(policy => policy.workerId === workerId)
      .sort((a, b) => b.version - a.version)[0] ?? null;
  const calendarAssigned = Boolean(
    selectedCalendar && model?.assignedCalendarId === selectedCalendar.calendarId,
  );
  const selectedCalendarYear = model?.calendarYears.find(
    value => value.calendarId === drafts.calendarId && value.calendarYear === Number(drafts.calendarYear),
  );
  const calendarYearComplete = Boolean(
    selectedCalendarYear &&
      selectedCalendarYear.confirmedRevision === selectedCalendarYear.revision,
  );
  const pendingInvalidMessage = pending ? invalidAnnualLeaveAttemptMessage(pending) : null;
  const changesDisabled =
    parentDisabled || busy || refreshing || importLoading || Boolean(pending) || storageBlocked || !model;
  const changesDisabledReason = parentDisabled
    ? parentDisabledReason || 'Scheduling is not ready for leave changes.'
    : busy
      ? 'Wait for the current leave change to finish.'
      : refreshing
        ? 'Wait for leave details to finish refreshing.'
        : pendingInvalidMessage
          ? 'Dismiss the invalid saved change above before saving another change.'
          : pending
            ? 'Resolve the saved change with Retry same change before saving another change.'
            : storageBlocked
              ? 'Saved recovery information is unavailable. Contact support before making changes.'
              : !model
                ? 'Refresh successfully before saving leave changes.'
                : '';
  const actionDisabledReason = pending ? '' : changesDisabledReason;
  const coreSetupComplete = Boolean(workerPolicy && account);
  const holidaySetupComplete = Boolean(account && calendarAssigned && calendarYearComplete);

  const update = <K extends keyof Drafts>(key: K, value: Drafts[K]) =>
    setDrafts(current => ({...current, [key]: value}));

  const savePolicy = () => {
    try {
      if (!validDate(drafts.leaveYearStart)) throw Error('Choose a valid leave-year start date.');
      const workingDayMinutes = exactMinutes(drafts.workingDayHours, 'hours', 1);
      if (workingDayMinutes <= 0) throw Error('Working-day hours must be greater than zero.');
      const allowanceMinutes = exactMinutes(
        drafts.allowanceValue,
        drafts.allowanceUnit,
        workingDayMinutes,
      );
      if (allowanceMinutes < 0) throw Error('Allowance cannot be negative.');
      const [year, month, day] = drafts.leaveYearStart.split('-').map(Number);
      void run('policy', {
        workerId,
        effectiveFromLeaveYear: year,
        allowanceInputUnit: drafts.allowanceUnit,
        allowanceInputValue: Number(drafts.allowanceValue),
        allowanceMinutes,
        hoursPerDayMinutes: workingDayMinutes,
        leaveYearStartMonth: month,
        leaveYearStartDay: day,
        bankHolidayTreatment: drafts.holidayTreatment,
        expectedVersion: workerPolicy?.version ?? 0,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check the leave settings and try again.');
    }
  };

  const openLeaveYear = () => {
    if (!validDate(drafts.leaveYearStart)) {
      setMessage('Choose a valid leave-year start date.');
      return;
    }
    void run('account', {workerId, leaveYearStart: drafts.leaveYearStart, expectedVersion: 0});
  };

  const saveAllowanceChange = () => {
    if (!account) return;
    try {
      const adjustmentMinutes = exactMinutes(
        drafts.adjustmentValue,
        drafts.adjustmentUnit,
        account.hoursPerDayMinutes,
      );
      if (adjustmentMinutes === 0) throw Error('Enter a non-zero allowance change.');
      if (!drafts.adjustmentReason.trim()) throw Error('Explain why the allowance is changing.');
      void run('adjustment', {
        accountId: account.accountId,
        adjustmentMinutes,
        reason: drafts.adjustmentReason.trim(),
        expectedVersion: account.version,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Check the allowance change and try again.');
    }
  };

  const saveCalendar = () => {
    const name = drafts.calendarName.trim();
    if (!name) {
      setMessage('Enter a calendar name.');
      return;
    }
    void run('calendar', {
      action: 'save_calendar',
      calendarId: null,
      name,
      regionCode: drafts.calendarRegion.trim().toUpperCase(),
      status: 'active',
      expectedVersion: 0,
    });
  };

  const dismissInvalidPending = () => {
    if (!pending || !invalidAnnualLeaveAttemptMessage(pending)) return;
    try {
      clearAnnualLeaveAttempt(window.sessionStorage, pending.workspaceId, userId);
      setPending(null);
      setMessage('Enter a calendar name.');
    } catch {
      setStorageBlocked(true);
      setMessage('The invalid saved change could not be dismissed. Contact support before making changes.');
    }
  };

  const assignCalendar = () =>
    void run('calendar', {
      action: 'assign_worker',
      workerId,
      calendarId: drafts.calendarId,
      expectedVersion: model?.assignmentVersion ?? 0,
    });

  const saveHoliday = (
    status: 'active' | 'cancelled',
    holiday?: {holidayId: string; holidayDate: string; name: string; version: number},
  ) =>
    void run('holiday', {
      calendarId: drafts.calendarId,
      holidayId: holiday?.holidayId ?? null,
      holidayDate: holiday?.holidayDate ?? drafts.holidayDate,
      name: holiday?.name ?? drafts.holidayName.trim(),
      status,
      expectedVersion: holiday?.version ?? 0,
    });

  const confirmYear = () =>
    void run('calendar', {
      action: 'confirm_year',
      calendarId: drafts.calendarId,
      calendarYear: Number(drafts.calendarYear),
      expectedVersion: selectedCalendarYear?.revision ?? 0,
    });

  const record = () => {
    if (!model?.timezone) {
      setMessage("This worker's working hours and timezone must be set before leave can be added.");
      return;
    }
    const startDate = drafts.startDate;
    const endDate = drafts.endDate || drafts.startDate;
    try {
      const startAt = localLeaveToUtc(
        `${startDate}T${drafts.recordMode === 'full' ? '00:00' : drafts.startTime}`,
        model.timezone,
      );
      const endAt = localLeaveToUtc(
        `${drafts.recordMode === 'full' ? addDay(endDate) : endDate}T${
          drafts.recordMode === 'full' ? '00:00' : drafts.endTime
        }`,
        model.timezone,
      );
      const lastAccountDate =
        drafts.recordMode === 'partial' && drafts.endTime === '00:00' ? subtractDay(endDate) : endDate;
      const expectedAccounts = expectedAccountsForDates(model, startDate, lastAccountDate);
      if (startAt >= endAt) throw Error('The end of the leave must be after the start.');
      void run('record', {workerId, startAt, endAt, expectedAccounts});
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Choose valid leave dates and times.');
    }
  };

  const cancelAbsence = (absence: AnnualLeaveAbsence) => {
    if (!model) return;
    const expectedAccounts = absence.accountIds.map(accountId => {
      const found = model.accounts.find(value => value.accountId === accountId);
      if (!found) throw Error('The current balance could not be loaded. Refresh before cancelling leave.');
      return {accountId, version: found.version};
    });
    void run('cancel', {
      absenceId: absence.absenceId,
      expectedVersion: absence.version,
      expectedAccounts,
    });
  };

  const cancelLegacy = (leave: LegacyAnnualLeave) =>
    void run('legacy_cancel', {
      workerId,
      unavailabilityId: leave.unavailabilityId,
      expectedVersion: leave.version,
    });

  return (
    <section aria-labelledby="annual-leave-title" className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="annual-leave-title" className="text-xl font-semibold">
            Annual Leave
          </h2>
          <p>Leave added here is confirmed immediately by the manager.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            disabled={busy || refreshing || !workerId}
            onClick={() => void refresh()}
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            className="btn-secondary"
            disabled={!workerId}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}
          >
            Leave settings
          </button>
        </div>
      </div>

      {parentDisabledReason && !pending && <p className="my-2 text-sm">{parentDisabledReason}</p>}
      {pending ? (
        <aside
          className="my-4 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-amber-950"
          aria-label="Pending annual leave change"
        >
          <h3 className="text-base font-semibold">A saved change needs attention</h3>
          <p className="mt-1 text-sm">
            {pendingInvalidMessage ??
              message ??
              'The result of the previous change is not confirmed. Retry the exact same change before saving another one.'}
          </p>
          <button
            className="btn-secondary mt-3"
            disabled={busy || refreshing || storageBlocked || (!pendingInvalidMessage && retryDisabled)}
            onClick={
              pendingInvalidMessage
                ? dismissInvalidPending
                : () => void run(pending.operation, pending.body, true)
            }
          >
            {pendingInvalidMessage ? 'Dismiss invalid change' : busy ? 'Retrying...' : 'Retry same change'}
          </button>
        </aside>
      ) : (
        message && <p role="status" className="my-3">{message}</p>
      )}

      <div className="my-5 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Worker
          <select
            className={fieldClass}
            value={workerId}
            disabled={busy || refreshing || Boolean(pending)}
            onChange={event => setWorkerId(event.target.value)}
          >
            <option value="">Select worker</option>
            {workers.map(worker => (
              <option value={worker.workerId} key={worker.workerId}>
                {worker.displayName}
                {worker.active ? '' : ' (archived)'}
              </option>
            ))}
          </select>
        </label>

        {model && model.accounts.length > 0 && (
          <label className={labelClass}>
            Leave year
            <select
              className={fieldClass}
              value={yearStart}
              onChange={event => setYearStart(event.target.value)}
            >
              {model.accounts.map(value => (
                <option key={value.accountId} value={value.leaveYearStart}>
                  {accountLabel(value)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {model && model.accounts.length > 0 ? (
        account && <AnnualLeaveBalance account={account} />
      ) : (
        model && (
          <div className="card p-4 my-4">
            <p className="font-medium">Leave has not been set up for this worker.</p>
            <button className="btn-primary mt-3" onClick={() => setSettingsOpen(true)}>
              Set up leave for this worker
            </button>
          </div>
        )
      )}

      {settingsOpen && (
        <section className="card p-4 my-4" aria-labelledby="leave-settings-title">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="leave-settings-title" className="font-semibold">
                Leave settings
              </h3>
              <p className="text-sm">These settings apply only to the selected worker.</p>
            </div>
            <button className="btn-secondary" onClick={() => setSettingsOpen(false)}>
              Close settings
            </button>
          </div>

          <div className="mt-4">
            {coreSetupComplete && !setupEditing ? (
              <section className="border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="font-medium">Allowance and leave year</h4>
                    <p className="text-sm text-neutral-600">
                      {drafts.allowanceValue} {drafts.allowanceUnit}; leave year starts {formatSchedulingDate(drafts.leaveYearStart)}.
                    </p>
                  </div>
                  <button type="button" className="btn-secondary" onClick={() => setSetupEditing(true)}>
                    Edit allowance and leave year
                  </button>
                </div>
              </section>
            ) : (
              <>
            <section className="border-t pt-4">
              <h4 className="font-medium">1. Allowance and leave year</h4>
              <p className="text-sm">
                Set this worker's allowance, normal working-day length, leave-year start and bank-holiday
                treatment.
              </p>
              <div className="grid gap-4 mt-4 sm:grid-cols-2">
                <label className={labelClass}>
                  Allowance
                  <input
                    className={fieldClass}
                    type="number"
                    step="0.01"
                    min="0"
                    value={drafts.allowanceValue}
                    onChange={event => update('allowanceValue', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  Allowance measured in
                  <select
                    className={fieldClass}
                    value={drafts.allowanceUnit}
                    onChange={event => update('allowanceUnit', event.target.value as Drafts['allowanceUnit'])}
                  >
                    <option value="days">Days</option>
                    <option value="hours">Hours</option>
                  </select>
                </label>
                <label className={labelClass}>
                  Hours in a normal working day
                  <input
                    className={fieldClass}
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={drafts.workingDayHours}
                    onChange={event => update('workingDayHours', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  Leave year starts
                  <input
                    className={fieldClass}
                    type="date"
                    value={drafts.leaveYearStart}
                    onChange={event => update('leaveYearStart', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  Bank holidays
                  <select
                    className={fieldClass}
                    value={drafts.holidayTreatment}
                    onChange={event =>
                      update('holidayTreatment', event.target.value as Drafts['holidayTreatment'])
                    }
                  >
                    <option value="included">Included in the allowance</option>
                    <option value="additional">Added on top of the allowance</option>
                  </select>
                </label>
              </div>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={changesDisabled}
                onClick={savePolicy}
              >
                Save worker leave settings
              </button>
              {actionDisabledReason && <p className="text-sm mt-2">{actionDisabledReason}</p>}
              {workerPolicy && <p className="text-sm mt-2">Step 1 complete for this worker.</p>}
            </section>

            <section className="border-t pt-4 mt-4">
              <h4 className="font-medium">2. Create the leave year</h4>
              <p className="text-sm">
                Confirm the start date above, then create this worker's leave year. Existing years are never
                replaced.
              </p>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={changesDisabled || !workerPolicy}
                onClick={openLeaveYear}
              >
                Create leave year
              </button>
              {!actionDisabledReason && !workerPolicy && (
                <p className="text-sm mt-2">Save this worker's leave settings before creating the leave year.</p>
              )}
              {actionDisabledReason && <p className="text-sm mt-2">{actionDisabledReason}</p>}
              {model?.accounts.some(value => value.leaveYearStart === drafts.leaveYearStart) && (
                <p className="text-sm mt-2">Step 2 complete for this leave year.</p>
              )}
            </section>
              </>
            )}

            {account && (
              <section className="border-t pt-4 mt-4">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-expanded={adjustmentsOpen}
                  onClick={() => setAdjustmentsOpen(open => !open)}
                >
                  {adjustmentsOpen ? 'Close allowance adjustments' : 'Allowance adjustments'}
                </button>
                {adjustmentsOpen && (
                  <div className="mt-4">
                <h4 className="font-medium">Change this year's allowance</h4>
                <p className="text-sm">
                  Use a positive value to add leave or a negative value to reduce it. Previous changes remain
                  in the history.
                </p>
                <div className="grid gap-4 mt-4 sm:grid-cols-3">
                  <label className={labelClass}>
                    Change by
                    <input
                      className={fieldClass}
                      type="number"
                      step="0.01"
                      value={drafts.adjustmentValue}
                      onChange={event => update('adjustmentValue', event.target.value)}
                    />
                  </label>
                  <label className={labelClass}>
                    Measured in
                    <select
                      className={fieldClass}
                      value={drafts.adjustmentUnit}
                      onChange={event =>
                        update('adjustmentUnit', event.target.value as Drafts['adjustmentUnit'])
                      }
                    >
                      <option value="days">Days</option>
                      <option value="hours">Hours</option>
                    </select>
                  </label>
                  <label className={labelClass}>
                    Reason
                    <input
                      className={fieldClass}
                      maxLength={500}
                      value={drafts.adjustmentReason}
                      onChange={event => update('adjustmentReason', event.target.value)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn-secondary mt-3"
                  disabled={changesDisabled}
                  onClick={saveAllowanceChange}
                >
                  Save allowance change
                </button>
                {actionDisabledReason && <p className="text-sm mt-2">{actionDisabledReason}</p>}
                <ul className="mt-3 text-sm">
                  {model?.adjustments
                    .filter(value => value.accountId === account.accountId)
                    .map(value => (
                      <li key={value.adjustmentId}>
                        {formatLeaveDayTotal(value.minutes, account.hoursPerDayMinutes)} — {value.reason}
                      </li>
                    ))}
                </ul>
                  </div>
                )}
              </section>
            )}

            <section className="border-t pt-4 mt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-medium">Bank/public holidays</h4>
                  <p className="text-sm">These are public holidays, not this worker's annual leave.</p>
                </div>
                {holidaySetupComplete && !holidaysEditing && (
                  <button type="button" className="btn-secondary" onClick={() => setHolidaysEditing(true)}>
                    Edit bank/public holidays
                  </button>
                )}
              </div>
              {holidaySetupComplete && !holidaysEditing ? (
                <p className="mt-3 text-sm text-neutral-600">
                  {selectedCalendar?.name} is assigned and {drafts.calendarYear} is confirmed complete.
                </p>
              ) : (
                <>
              <OfficialBankHolidayImport
                key={`${scope}:${workerId}:${drafts.calendarId}:${selectedCalendar?.version}:${selectedCalendarYear?.revision}:${model?.assignmentVersion}`}
                workspaceId={workspaceId}
                workerId={workerId}
                calendarId={selectedCalendar?.calendarId ?? null}
                regionCode={selectedCalendar?.regionCode}
                year={drafts.calendarYear}
                disabled={changesDisabled && !importLoading}
                invoke={invoke}
                onLoading={setImportLoading}
                onConfirm={previewId => void run('import', {action: 'confirm', workerId, previewId})}
              />
              <details className="mt-4">
              <summary className="cursor-pointer font-medium">Manual calendar controls</summary>
              <p className="text-sm">
                REV never invents holiday dates. Choose or create a calendar, assign it to this worker, review
                every holiday for the year, then confirm that the list is complete. Adding or removing a
                holiday means the year must be reviewed again. Changes to a shared calendar affect every
                worker assigned to it.
              </p>
              <div className="grid gap-4 mt-4 sm:grid-cols-2">
                <label className={labelClass}>
                  New calendar name
                  <input
                    className={fieldClass}
                    placeholder="e.g. England and Wales"
                    value={drafts.calendarName}
                    onChange={event => update('calendarName', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  Region
                  <input
                    className={fieldClass}
                    value={drafts.calendarRegion}
                    onChange={event => update('calendarRegion', event.target.value)}
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={changesDisabled || !account || !drafts.calendarName.trim()}
                onClick={saveCalendar}
              >
                Create holiday calendar
              </button>
              {actionDisabledReason ? (
                <p className="text-sm mt-2">{actionDisabledReason}</p>
              ) : !account ? (
                <p className="text-sm mt-2">Create the leave year before setting up holidays.</p>
              ) : !drafts.calendarName.trim() ? (
                <p className="text-sm mt-2">Enter a calendar name.</p>
              ) : null}

              <label className={`${labelClass} mt-4`}>
                Holiday calendar for this worker
                <select
                  className={fieldClass}
                  disabled={!account}
                  value={drafts.calendarId}
                  onChange={event => update('calendarId', event.target.value)}
                >
                  <option value="">Select calendar</option>
                  {model?.calendars
                    .filter(value => value.status === 'active')
                    .map(value => (
                      <option value={value.calendarId} key={value.calendarId}>
                        {value.name} ({value.regionCode})
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-secondary mt-3"
                disabled={changesDisabled || !account || !selectedCalendar || calendarAssigned}
                onClick={assignCalendar}
              >
                Assign calendar to this worker
              </button>
              {actionDisabledReason ? (
                <p className="text-sm mt-2">{actionDisabledReason}</p>
              ) : !account ? (
                <p className="text-sm mt-2">Create the leave year before assigning a holiday calendar.</p>
              ) : !selectedCalendar ? (
                <p className="text-sm mt-2">Choose a holiday calendar to assign.</p>
              ) : calendarAssigned ? (
                <p className="text-sm mt-2">Calendar assigned to this worker.</p>
              ) : null}

              {account && calendarAssigned && (
                <>
                  <div className="grid gap-4 mt-4 sm:grid-cols-2">
                    <label className={labelClass}>
                      Bank holiday date
                      <input
                        className={fieldClass}
                        type="date"
                        value={drafts.holidayDate}
                        onChange={event => update('holidayDate', event.target.value)}
                      />
                    </label>
                    <label className={labelClass}>
                      Bank holiday name
                      <input
                        className={fieldClass}
                        value={drafts.holidayName}
                        onChange={event => update('holidayName', event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary mt-3"
                    disabled={changesDisabled}
                    onClick={() => saveHoliday('active')}
                  >
                    Add bank holiday
                  </button>
                  {actionDisabledReason && <p className="text-sm mt-2">{actionDisabledReason}</p>}
                  <ul className="mt-3">
                    {model?.holidays
                      .filter(value => value.calendarId === drafts.calendarId)
                      .map(holiday => (
                        <li className="flex flex-wrap items-center gap-2 py-1" key={holiday.holidayId}>
                          <span>
                            {formatSchedulingDate(holiday.holidayDate)}: {holiday.name} ({holiday.status === 'active' ? 'Included' : 'Removed'})
                          </span>
                          {holiday.status === 'active' && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={changesDisabled}
                              onClick={() => saveHoliday('cancelled', holiday)}
                            >
                              Remove holiday
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>

                  <label className={`${labelClass} mt-4`}>
                    Year being reviewed
                    <input
                      className={fieldClass}
                      type="number"
                      min="1000"
                      max="9999"
                      value={drafts.calendarYear}
                      onChange={event => update('calendarYear', event.target.value)}
                    />
                  </label>
                  <p className="text-sm mt-2">
                    {calendarYearComplete
                      ? `${drafts.calendarYear} is confirmed complete.`
                      : `${drafts.calendarYear} still needs a complete holiday review.`}
                  </p>
                  <button
                    type="button"
                    className="btn-secondary mt-3"
                    disabled={changesDisabled}
                    onClick={confirmYear}
                  >
                    Confirm {drafts.calendarYear} holiday list is complete
                  </button>
                  {actionDisabledReason && <p className="text-sm mt-2">{actionDisabledReason}</p>}
                </>
              )}
              </details>
                </>
              )}
            </section>
          </div>
        </section>
      )}

      <section className="card p-4 my-4" aria-labelledby="add-leave-title">
        <h3 id="add-leave-title" className="font-semibold">
          Add annual leave
        </h3>
        <fieldset disabled={changesDisabled || !account || !selectedWorker?.active} className="mt-3 space-y-4">
          <p className="text-sm">
            {model?.timezone
              ? `Dates and times use ${model.timezone}. Your saved working hours determine the final balance change.`
              : "Set this worker's working hours and timezone before adding leave."}
          </p>
          {selectedWorker && !selectedWorker.active && (
            <p>This worker is archived. Existing leave can be reviewed or cancelled, but new leave cannot be added.</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Leave type
              <select
                className={fieldClass}
                value={drafts.recordMode}
                onChange={event => update('recordMode', event.target.value as Drafts['recordMode'])}
              >
                <option value="full">Full day or several full days</option>
                <option value="partial">Custom hours</option>
              </select>
            </label>
            <label className={labelClass}>
              First date
              <input
                className={fieldClass}
                type="date"
                value={drafts.startDate}
                onChange={event => update('startDate', event.target.value)}
              />
            </label>
            <label className={labelClass}>
              Last date
              <input
                className={fieldClass}
                type="date"
                value={drafts.endDate}
                onChange={event => update('endDate', event.target.value)}
              />
            </label>
            {drafts.recordMode === 'partial' && (
              <>
                <label className={labelClass}>
                  Start time
                  <input
                    className={fieldClass}
                    type="time"
                    value={drafts.startTime}
                    onChange={event => update('startTime', event.target.value)}
                  />
                </label>
                <label className={labelClass}>
                  End time
                  <input
                    className={fieldClass}
                    type="time"
                    value={drafts.endTime}
                    onChange={event => update('endTime', event.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <button type="button" className="btn-primary" onClick={record}>
            Save annual leave
          </button>
        </fieldset>
        {!account && model && (
          <p className="text-sm mt-3">Set up a leave year for this worker before adding leave.</p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="font-semibold">Leave history</h3>
        <AnnualLeaveHistory
          absences={model?.absences ?? []}
          accounts={model?.accounts ?? []}
          legacy={model?.legacyLeave ?? []}
          legacyDisplayTimezone={model?.timezone ?? 'UTC'}
          disabled={changesDisabled}
          onCancel={cancelAbsence}
          onCancelLegacy={cancelLegacy}
        />
      </section>
    </section>
  );
}

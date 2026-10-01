import type { OAuthInvoke } from './calendarOAuthBrowser';
import type { SchedulingJob } from './schedulingJobs';
import { localLeaveToUtc } from './workerUnavailability.ts';

export interface DailySessionPlan {
  title: string;
  timezone: string;
  location: string;
  requiredSkills: string[];
  staffingCount: number;
  firstDay: string;
  lastDay: string;
  workingDays: number[];
  startLocal: string;
  endLocal: string;
}

export interface DailySessionAttempt extends DailySessionPlan {
  workspaceId: string;
  requestId: string;
}

export interface DailySessionPreview {
  date: string;
  startLocal: string;
  endLocal: string;
  startAt: string;
  endAt: string;
}

export interface DailySessionResult {
  requestId: string;
  workspaceId: string;
  scheduleType: 'daily_daytime';
  jobs: SchedulingJob[];
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clock = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const inputKeys = 'endLocal,firstDay,lastDay,location,requestId,requiredSkills,staffingCount,startLocal,timezone,title,workingDays,workspaceId';
const resultKeys = 'jobs,requestId,scheduleType,workspaceId';
const jobKeys = 'endAt,jobId,location,requiredSkills,staffingCount,startAt,status,timezone,title,version,workspaceId';

function id(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Daily schedule unavailable.');
  return value as Record<string, unknown>;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const parsed = Date.parse(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validTags(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 30
    && value.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 80 && tag === tag.trim())
    && new Set(value).size === value.length;
}

function instant(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid session time.');
  return new Date(value).toISOString();
}

function validatePlan(value: DailySessionPlan): DailySessionPlan {
  const input = value as unknown as Record<string, unknown>;
  if (typeof input.title !== 'string' || input.title !== input.title.trim() || input.title.length < 1 || input.title.length > 160
    || typeof input.location !== 'string' || input.location !== input.location.trim() || input.location.length < 1 || input.location.length > 300
    || !validTimezone(input.timezone) || !validTags(input.requiredSkills)
    || !Number.isInteger(input.staffingCount) || (input.staffingCount as number) < 1 || (input.staffingCount as number) > 100
    || !validDate(input.firstDay) || !validDate(input.lastDay) || input.lastDay < input.firstDay
    || (Date.parse(`${input.lastDay}T12:00:00.000Z`) - Date.parse(`${input.firstDay}T12:00:00.000Z`)) / 86400000 > 30
    || !Array.isArray(input.workingDays) || input.workingDays.length < 1 || input.workingDays.length > 7
    || input.workingDays.some(day => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)
    || new Set(input.workingDays).size !== input.workingDays.length
    || typeof input.startLocal !== 'string' || typeof input.endLocal !== 'string'
    || !clock.test(input.startLocal) || !clock.test(input.endLocal) || input.startLocal >= input.endLocal) {
    throw new Error('Valid daily schedule required.');
  }
  return {
    ...(value as DailySessionPlan),
    requiredSkills: [...(input.requiredSkills as string[])].sort(),
    workingDays: [...(input.workingDays as number[])].sort((left, right) => left - right),
  };
}

export function previewDailySessions(value: DailySessionPlan): DailySessionPreview[] {
  const input = validatePlan(value);
  const result: DailySessionPreview[] = [];
  const first = Date.parse(`${input.firstDay}T12:00:00.000Z`);
  for (let offset = 0; offset <= 30; offset += 1) {
    const day = new Date(first + offset * 86400000).toISOString().slice(0, 10);
    if (day > input.lastDay) break;
    const isoDay = new Date(`${day}T12:00:00.000Z`).getUTCDay() || 7;
    if (input.workingDays.includes(isoDay)) {
      try {
        const startAt = localLeaveToUtc(`${day}T${input.startLocal}`, input.timezone);
        const endAt = localLeaveToUtc(`${day}T${input.endLocal}`, input.timezone);
        if (startAt >= endAt) throw new Error('Invalid session interval.');
        result.push({ date: day, startLocal: input.startLocal, endLocal: input.endLocal, startAt, endAt });
      } catch {
        throw new Error(`The selected hours on ${day} are ambiguous or nonexistent in ${input.timezone}. Choose different daytime hours.`);
      }
    }
    if (day === input.lastDay) break;
  }
  if (result.length === 0) throw new Error('Choose at least one scheduled day.');
  return result;
}

export function validateDailySessionAttempt(value: unknown): DailySessionAttempt {
  const input = object(value);
  if (Object.keys(input).sort().join(',') !== inputKeys || !id(input.workspaceId) || !id(input.requestId)) throw new Error('Valid daily schedule required.');
  const plan = validatePlan(input as unknown as DailySessionPlan);
  return {
    ...(input as unknown as DailySessionAttempt),
    requiredSkills: plan.requiredSkills,
    workingDays: plan.workingDays,
  };
}

export async function submitDailySessionAttempt(attempt: DailySessionAttempt, invoke: OAuthInvoke): Promise<DailySessionResult> {
  const input = validateDailySessionAttempt(attempt);
  const expected = previewDailySessions(input);
  const result = object(await invoke('rev-scheduling-daily-sessions-save', { ...input }));
  if (Object.keys(result).sort().join(',') !== resultKeys || result.requestId !== input.requestId
    || result.workspaceId !== input.workspaceId || result.scheduleType !== 'daily_daytime'
    || !Array.isArray(result.jobs) || result.jobs.length !== expected.length) throw new Error('Save unconfirmed.');
  const seen = new Set<string>();
  const jobs = result.jobs.map((candidate, index) => {
    const job = object(candidate);
    if (Object.keys(job).sort().join(',') !== jobKeys || !id(job.jobId) || seen.has(job.jobId)
      || job.workspaceId !== input.workspaceId || job.title !== input.title || job.timezone !== input.timezone
      || job.location !== input.location || JSON.stringify(job.requiredSkills) !== JSON.stringify(input.requiredSkills)
      || job.staffingCount !== input.staffingCount || job.status !== 'open' || job.version !== 1) throw new Error('Save unconfirmed.');
    const startAt = instant(job.startAt);
    const endAt = instant(job.endAt);
    if (startAt !== expected[index].startAt || endAt !== expected[index].endAt) throw new Error('Save unconfirmed.');
    seen.add(job.jobId);
    return { ...job, startAt, endAt } as unknown as SchedulingJob;
  });
  return { requestId: input.requestId, workspaceId: input.workspaceId, scheduleType: 'daily_daytime', jobs };
}

function storageKey(workspaceId: string, userId: string): string {
  if (!id(workspaceId) || !id(userId)) throw new Error('Scoped identity required.');
  return `rev-daily-job-save:${workspaceId}:${userId}`;
}

export function rememberDailySessionAttempt(storage: Storage, userId: string, attempt: DailySessionAttempt): void {
  const input = validateDailySessionAttempt(attempt);
  previewDailySessions(input);
  storage.setItem(storageKey(input.workspaceId, userId), JSON.stringify(input));
}

export function restoreDailySessionAttempt(storage: Storage, workspaceId: string, userId: string): DailySessionAttempt | null {
  const raw = storage.getItem(storageKey(workspaceId, userId));
  if (raw === null) return null;
  const input = validateDailySessionAttempt(JSON.parse(raw));
  previewDailySessions(input);
  if (input.workspaceId !== workspaceId) throw new Error('Pending daily schedule unavailable.');
  return input;
}

export function clearDailySessionAttempt(storage: Storage, workspaceId: string, userId: string): void {
  storage.removeItem(storageKey(workspaceId, userId));
}
import { resolveAnnualLeaveOrigin } from './annualLeaveOrigins.ts';
// Dedicated Scheduling allowlist. Existing single-origin/local-alias behaviour is retained.
export function resolveSchedulingOrigin(origin: string | null, configured?: string): string | null {
  if (!origin || !configured) return null;
  return configured.split(',').map(value => value.trim()).filter(Boolean).some(value => resolveAnnualLeaveOrigin(origin, value) !== null) ? origin : null;
}

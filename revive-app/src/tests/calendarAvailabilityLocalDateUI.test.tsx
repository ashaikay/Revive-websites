// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarAvailabilityPanel } from '@/components/CalendarAvailabilityPanel';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('calendar availability business-local date', () => {
  it('requests the current London working day when UTC is still on the previous date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T23:00:00.000Z'));
    const requestAvailability = vi.fn().mockResolvedValue({
      status: 'available',
      timezone: 'Europe/London',
      slots: [{ startAt: '2026-10-09T08:00:00.000Z', endAt: '2026-10-09T08:30:00.000Z' }],
    });

    render(<CalendarAvailabilityPanel workspaceId="workspace-1" requestAvailability={requestAvailability} />);

    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-09');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'CHECK AVAILABILITY' }));
    });

    expect(requestAvailability).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      searchStartAt: '2026-10-08T23:00:00.000Z',
      searchEndAt: '2026-10-09T23:00:00.000Z',
      requestedDurationMinutes: 30,
      timezone: 'Europe/London',
    });
    expect(screen.getByText('09:00 - 09:30')).toBeInTheDocument();
  });
});

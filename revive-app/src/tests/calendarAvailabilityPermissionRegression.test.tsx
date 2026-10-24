// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarAvailabilityPanel } from '@/components/CalendarAvailabilityPanel';

vi.mock('@/data/supabaseClient', () => ({ supabaseClient: null }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('calendar selection and proposal permission', () => {
  it.each([undefined, false, true])('keeps selecting a slot local with permission %s', async (permission) => {
    const requestAvailability = vi.fn().mockResolvedValue({
      status: 'available', timezone: 'Europe/London',
      slots: [{ startAt: '2030-09-30T09:00:00.000Z', endAt: '2030-09-30T09:30:00.000Z' }],
    });
    const submitProposal = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
    render(<CalendarAvailabilityPanel workspaceId="workspace-1"
      requestAvailability={requestAvailability} submitProposal={submitProposal}
      {...(permission === undefined ? {} : { canSubmitProposal: permission })} />);
    expect(requestAvailability).not.toHaveBeenCalled();
    expect(submitProposal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2030-09-30' } });
    fireEvent.click(screen.getByRole('button', { name: 'CHECK AVAILABILITY' }));
    const slot = await screen.findByRole('button', { pressed: false });
    fireEvent.click(slot);
    expect(slot).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('SELECTED — NOT BOOKED')).toBeInTheDocument();
    expect(requestAvailability).toHaveBeenCalledTimes(1);
    expect(submitProposal).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    const prepare = screen.queryByRole('button', { name: 'PREPARE MEETING PROPOSAL' });
    if (permission === true) expect(prepare).toBeInTheDocument();
    else {
      expect(prepare).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Meeting title')).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /\b(book|schedule|execute)\b|create event|send invitation|confirm booking/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'CLEAR SELECTION' }));
    expect(screen.queryByText('SELECTED — NOT BOOKED')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'PREPARE MEETING PROPOSAL' })).not.toBeInTheDocument();
    expect(submitProposal).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

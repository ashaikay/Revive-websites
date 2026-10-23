// A reminder-only setting avoids modifying calendar and other function origins.
export function meetingReminderAllowedOrigin(read: (name: string) => string | undefined) {
  return read('REV_MEETING_REMINDER_ALLOWED_ORIGIN')
    ?? read('REV_CALENDAR_OAUTH_ALLOWED_ORIGIN');
}

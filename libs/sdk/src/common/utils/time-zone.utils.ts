/** Whether the runtime knows `timezone` as an IANA time zone, such as `'Europe/Berlin'` or `'UTC'`. */
export function isIanaTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
export interface BusinessCalendar { workingDays: number[]; holidays: string[]; }

/** Adds elapsed working hours using Asia/Riyadh wall-clock days, never server-local time. */
export function addRiyadhWorkingHours(start: Date, hours: number, calendar: BusinessCalendar): Date {
  if (!Number.isFinite(hours) || hours < 0 || calendar.workingDays.length === 0) throw new Error('Invalid business calendar');
  const holidays = new Set(calendar.holidays); let cursor = new Date(start); let remaining = hours;
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    const local = new Date(cursor.getTime() + RIYADH_OFFSET_MS);
    const date = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
    if (calendar.workingDays.includes(local.getUTCDay()) && !holidays.has(date)) remaining -= 1;
  }
  return cursor;
}

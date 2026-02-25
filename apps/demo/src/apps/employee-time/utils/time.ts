export function toMs(input: number | string | Date): number {
  if (typeof input === 'number') return input;
  if (input instanceof Date) return input.getTime();
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) throw new Error(`Invalid date/time: ${input}`);
  return parsed;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = pad2(d.getMonth() + 1);
  const day = pad2(d.getDate());
  return `${y}-${m}-${day}`;
}

export function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function startOfWeekMs(ms: number): number {
  const d = new Date(ms);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day; // make Monday start
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfWeekMs(ms: number): number {
  const start = startOfWeekMs(ms);
  const d = new Date(start);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function startOfMonthMs(ms: number): number {
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfMonthMs(ms: number): number {
  const d = new Date(ms);
  d.setMonth(d.getMonth() + 1, 0); // last day of current month
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function eachDayRange(startMs: number, endMs: number): string[] {
  const days: string[] = [];
  let cur = startOfDayMs(startMs);
  const end = startOfDayMs(endMs);
  while (cur <= end) {
    days.push(formatDay(cur));
    const d = new Date(cur);
    d.setDate(d.getDate() + 1);
    cur = d.getTime();
  }
  return days;
}

export type SessionSegment = { day: string; start: number; end: number; durationMs: number };

export function splitSessionByDay(start: number, end: number): SessionSegment[] {
  if (end < start) throw new Error('end must be >= start');
  const segments: SessionSegment[] = [];
  let curStart = start;
  while (curStart <= end) {
    const sod = startOfDayMs(curStart);
    const eod = endOfDayMs(curStart);
    const segEnd = Math.min(eod, end);
    const day = formatDay(curStart);
    const durationMs = Math.max(0, segEnd - curStart);
    segments.push({ day, start: curStart, end: segEnd, durationMs });
    if (segEnd === end) break;
    const next = new Date(sod);
    next.setDate(next.getDate() + 1);
    curStart = next.getTime();
  }
  return segments;
}

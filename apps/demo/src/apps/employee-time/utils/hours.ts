import EmployeeRedisProvider from '../providers/redis.provider';
import {eachDayRange} from './time';
import {hoursKey} from './keys';

// Legacy helpers (non-site-aware) kept for backward compatibility with any remaining callers
export function empDayHoursKey(id: string, day: string) { return `et:hours:${id}:${day}`; }
export function employeesSetKey() { return 'et:employees'; }

export async function listEmployees(redis: EmployeeRedisProvider): Promise<string[]> {
  return redis.smembers(employeesSetKey());
}

export async function getEmployeeDayMs(redis: EmployeeRedisProvider, employeeId: string, day: string): Promise<number> {
  const v = await redis.get(empDayHoursKey(employeeId, day));
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function sumEmployeeDaysMs(redis: EmployeeRedisProvider, employeeId: string, days: string[]): Promise<number> {
  if (days.length === 0) return 0;
  const keys = days.map((d) => empDayHoursKey(employeeId, d));
  const vals = await redis.mget(keys);
  let total = 0;
  for (const v of vals) {
    const n = v ? Number(v) : 0;
    total += Number.isFinite(n) ? n : 0;
  }
  return total;
}

export async function sumEmployeesRangeMs(redis: EmployeeRedisProvider, employeeIds: string[], startMs: number, endMs: number): Promise<Record<string, number>> {
  const days = eachDayRange(startMs, endMs);
  const result: Record<string, number> = {};
  for (const id of employeeIds) {
    result[id] = await sumEmployeeDaysMs(redis, id, days);
  }
  return result;
}

// New site-aware helpers
export async function getEmployeeDayMsForSite(redis: EmployeeRedisProvider, siteId: string, employeeId: string, day: string): Promise<number> {
  const v = await redis.get(hoursKey(siteId, employeeId, day));
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function sumEmployeeDaysMsForSite(redis: EmployeeRedisProvider, siteId: string, employeeId: string, days: string[]): Promise<number> {
  if (days.length === 0) return 0;
  const keys = days.map((d) => hoursKey(siteId, employeeId, d));
  const vals = await redis.mget(keys);
  let total = 0;
  for (const v of vals) {
    const n = v ? Number(v) : 0;
    total += Number.isFinite(n) ? n : 0;
  }
  return total;
}

export async function sumEmployeesRangeMsForSite(redis: EmployeeRedisProvider, siteId: string, employeeIds: string[], startMs: number, endMs: number): Promise<Record<string, number>> {
  const days = eachDayRange(startMs, endMs);
  const result: Record<string, number> = {};
  for (const id of employeeIds) {
    result[id] = await sumEmployeeDaysMsForSite(redis, siteId, id, days);
  }
  return result;
}

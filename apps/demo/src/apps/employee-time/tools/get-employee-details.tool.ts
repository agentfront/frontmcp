import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import EmployeeRedisProvider from '../providers/redis.provider';
import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import { eachDayRange, endOfMonthMs, endOfWeekMs, formatDay, startOfMonthMs, startOfWeekMs } from '../utils/time';
import { getEmployeeDayMsForSite } from '../utils/hours';
import { openKey as siteOpenKey } from '../utils/keys';

@Tool({
  name: 'get-employee-details',
  description: 'Get employee presence details: open status and today/week/month totals (optionally per site)',
  inputSchema: { employeeId: z.string().min(1), siteId: z.string().min(1).optional() },
  outputSchema: z.object({
    employeeId: z.string(),
    open: z.boolean(),
    openSince: z.number().optional(),
    todayMs: z.number(),
    weekMs: z.number(),
    monthMs: z.number(),
    todayHours: z.number(),
    weekHours: z.number(),
    monthHours: z.number(),
  }),
})
export default class GetEmployeeDetailsTool extends ToolContext {
  async execute(input: { employeeId: string; siteId?: string }) {
    const redis = this.get(EmployeeRedisProvider);
    const dir = this.get(EmployeeDirectoryProvider);
    const { employeeId } = input;

    const now = Date.now();
    const today = formatDay(now);
    const weekStart = startOfWeekMs(now);
    const weekEnd = endOfWeekMs(now);
    const monthStart = startOfMonthMs(now);
    const monthEnd = endOfMonthMs(now);

    const sites = input.siteId ? [input.siteId] : await dir.listSitesForEmployee(employeeId);

    let open = false;
    let openSince: number | undefined = undefined;

    let todayMs = 0,
      weekMs = 0,
      monthMs = 0;

    for (const siteId of sites) {
      const openStr = await redis.get(siteOpenKey(siteId, employeeId));
      if (openStr) {
        open = true;
        const os = Number(openStr);
        openSince = openSince === undefined ? os : Math.min(openSince, os);
      }

      todayMs += await getEmployeeDayMsForSite(redis, siteId, employeeId, today);

      // Sum week
      const weekDays = eachDayRange(weekStart, weekEnd);
      for (const d of weekDays) {
        weekMs += await getEmployeeDayMsForSite(redis, siteId, employeeId, d);
      }

      // Sum month
      const monthDays = eachDayRange(monthStart, monthEnd);
      for (const d of monthDays) {
        monthMs += await getEmployeeDayMsForSite(redis, siteId, employeeId, d);
      }
    }

    const toHours = (ms: number) => Math.round((ms / 3600000) * 1000) / 1000;

    return {
      employeeId,
      open,
      openSince,
      todayMs,
      weekMs,
      monthMs,
      todayHours: toHours(todayMs),
      weekHours: toHours(weekMs),
      monthHours: toHours(monthMs),
    };
  }
}

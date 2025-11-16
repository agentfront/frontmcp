import {Tool, ToolContext} from '@frontmcp/sdk';
import {z} from 'zod';
import EmployeeRedisProvider from '../providers/redis.provider';
import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import {eachDayRange, endOfDayMs, endOfMonthMs, endOfWeekMs, startOfDayMs, startOfMonthMs, startOfWeekMs, toMs} from '../utils/time';
import {sumEmployeeDaysMsForSite, sumEmployeesRangeMsForSite} from '../utils/hours';

const PeriodEnum = z.enum(['day', 'week', 'month']);

@Tool({
  name: 'report-hours',
  description: 'Report total worked time for a day/week/month. Optionally filter by siteId and/or employeeId.',
  inputSchema: {
    period: PeriodEnum,
    at: z.union([z.number(), z.string()]).optional(),
    siteId: z.string().min(1).optional(),
    employeeId: z.string().min(1).optional(),
  },
  outputSchema: {} as any,
})
export default class ReportHoursTool extends ToolContext {
  async execute(input: { period: 'day'|'week'|'month', at?: number | string, siteId?: string, employeeId?: string }): Promise<any> {
    const redis = this.get(EmployeeRedisProvider);
    const dir = this.get(EmployeeDirectoryProvider);
    const atMs = input.at !== undefined ? toMs(input.at) : Date.now();

    let start: number;
    let end: number;
    switch (input.period) {
      case 'day':
        start = startOfDayMs(atMs);
        end = endOfDayMs(atMs);
        break;
      case 'week':
        start = startOfWeekMs(atMs);
        end = endOfWeekMs(atMs);
        break;
      case 'month':
        start = startOfMonthMs(atMs);
        end = endOfMonthMs(atMs);
        break;
    }

    const days = eachDayRange(start, end);

    // Case 1: both siteId and employeeId provided: report for that employee at that site
    if (input.siteId && input.employeeId) {
      const totalMs = await sumEmployeeDaysMsForSite(redis, input.siteId, input.employeeId, days);
      const totalHours = Math.round((totalMs / 3600000) * 1000) / 1000;
      return { result: { scope: 'site+employee', period: input.period, start, end, siteId: input.siteId, employeeId: input.employeeId, totalMs, totalHours } };
    }

    // Case 2: siteId only: all employees at that site
    if (input.siteId && !input.employeeId) {
      const employees = await dir.listEmployees({ siteId: input.siteId }).then(r => r.items);
      const totalsMs = await sumEmployeesRangeMsForSite(redis, input.siteId, employees, start, end);
      const totals: Record<string, { ms: number; hours: number }> = {};
      for (const id of employees) {
        const ms = totalsMs[id] || 0;
        totals[id] = { ms, hours: Math.round((ms / 3600000) * 1000) / 1000 };
      }
      return { result: { scope: 'site', period: input.period, start, end, siteId: input.siteId, employees: employees.length, totals } };
    }

    // Case 3: employeeId only: aggregate across all their sites
    if (!input.siteId && input.employeeId) {
      const sites = await dir.listSitesForEmployee(input.employeeId);
      let totalMs = 0;
      for (const s of sites) {
        totalMs += await sumEmployeeDaysMsForSite(redis, s, input.employeeId, days);
      }
      const totalHours = Math.round((totalMs / 3600000) * 1000) / 1000;
      return { result: { scope: 'employee(all-sites)', period: input.period, start, end, employeeId: input.employeeId, totalMs, totalHours } };
    }

    // Case 4: neither siteId nor employeeId: all employees across authorized sites aggregated by site
    const sites = await dir.listSites();
    const bySite: Record<string, { employees: number; totals: Record<string, { ms: number; hours: number }> }> = {};
    for (const s of sites) {
      const employees = await dir.listEmployees({ siteId: s }).then(r => r.items);
      const totalsMs = await sumEmployeesRangeMsForSite(redis, s, employees, start, end);
      const totals: Record<string, { ms: number; hours: number }> = {};
      for (const id of employees) {
        const ms = totalsMs[id] || 0;
        totals[id] = { ms, hours: Math.round((ms / 3600000) * 1000) / 1000 };
      }
      bySite[s] = { employees: employees.length, totals };
    }

    return { result: { scope: 'all', period: input.period, start, end, sites: bySite } };
  }
}

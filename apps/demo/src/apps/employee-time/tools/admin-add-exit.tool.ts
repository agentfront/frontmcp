import { Tool, ToolContext } from '@frontmcp/sdk';
import { z } from 'zod';
import EmployeeRedisProvider from '../providers/redis.provider';
import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import { splitSessionByDay, toMs } from '../utils/time';
import { openKey as siteOpenKey, hoursKey, sessionsKey } from '../utils/keys';

@Tool({
  name: 'admin-add-exit',
  description: 'Admin: add an exit (end) for an employee at a specific time (must have an open session) at a site',
  inputSchema: {
    admin: z.boolean().refine((v) => v === true, 'Admin privileges required'),
    employeeId: z.string().min(1),
    siteId: z.string().min(1),
    at: z.union([z.number(), z.string()]),
  },
  outputSchema: z.object({
    employeeId: z.string(),
    endedAt: z.number(),
    durationMs: z.number(),
  }),
})
export default class AdminAddExitTool extends ToolContext {
  async execute(input: { admin: boolean; employeeId: string; siteId: string; at: number | string }) {
    const redis = this.get(EmployeeRedisProvider);
    const dir = this.get(EmployeeDirectoryProvider);
    const { employeeId, siteId } = input;
    const end = toMs(input.at);

    const openKey = siteOpenKey(siteId, employeeId);
    const openStartStr = await redis.get(openKey);
    if (!openStartStr) {
      throw new Error(`Employee ${employeeId} does not have an open session at site ${siteId}`);
    }
    const start = Number(openStartStr);
    if (!Number.isFinite(start) || end < start) {
      throw new Error('Invalid open session times');
    }

    await dir.addEmployeeToSite(employeeId, siteId);

    const segments = splitSessionByDay(start, end);
    let total = 0;
    for (const seg of segments) {
      total += seg.durationMs;
      await redis.incrBy(hoursKey(siteId, employeeId, seg.day), seg.durationMs);
      await redis.lpush(
        sessionsKey(siteId, employeeId, seg.day),
        JSON.stringify({ start: seg.start, end: seg.end, durationMs: seg.durationMs }),
      );
    }

    await redis.del(openKey);

    return { employeeId, endedAt: end, durationMs: total };
  }
}

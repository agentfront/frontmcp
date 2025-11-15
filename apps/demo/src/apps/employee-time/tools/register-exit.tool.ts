import {Tool, ToolContext} from '@frontmcp/sdk';
import {z} from 'zod';
import EmployeeRedisProvider from '../providers/redis.provider';
import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import {splitSessionByDay} from '../utils/time';
import {openKey as siteOpenKey, hoursKey, sessionsKey} from '../utils/keys';

@Tool({
  name: 'register-exit',
  description: 'Register end of a work session for an employee (now) at a site',
  inputSchema: { employeeId: z.string().min(1), siteId: z.string().min(1) },
  outputSchema: { result: z.object({ employeeId: z.string(), endedAt: z.number(), durationMs: z.number() }) as any }
})
export default class RegisterExitTool extends ToolContext {
  async execute(input: { employeeId: string, siteId: string }): Promise<{ result: { employeeId: string, endedAt: number, durationMs: number } }> {
    const redis = this.get(EmployeeRedisProvider);
    const dir = this.get(EmployeeDirectoryProvider);
    const { employeeId, siteId } = input;

    const openKey = siteOpenKey(siteId, employeeId);
    const openStartStr = await redis.get(openKey);
    if (!openStartStr) {
      throw new Error(`Employee ${employeeId} does not have an open session at site ${siteId}`);
    }
    const start = Number(openStartStr);
    const end = Date.now();
    if (!Number.isFinite(start) || end < start) {
      throw new Error('Invalid open session times');
    }

    await dir.addEmployeeToSite(employeeId, siteId);

    const segments = splitSessionByDay(start, end);
    let total = 0;
    for (const seg of segments) {
      total += seg.durationMs;
      await redis.incrBy(hoursKey(siteId, employeeId, seg.day), seg.durationMs);
      await redis.lpush(sessionsKey(siteId, employeeId, seg.day), JSON.stringify({ start: seg.start, end: seg.end, durationMs: seg.durationMs }));
    }

    await redis.del(openKey);

    return { result: { employeeId, endedAt: end, durationMs: total } };
  }
}

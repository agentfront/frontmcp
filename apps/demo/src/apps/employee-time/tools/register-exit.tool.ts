import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import EmployeeRedisProvider from '../providers/redis.provider';
import { openKey as siteOpenKey } from '../utils/keys';
import { splitSessionByDay } from '../utils/time';

@Tool({
  name: 'register-exit',
  description: 'Register end of a work session for an employee (now) at a site',
  inputSchema: { employeeId: z.string().min(1), siteId: z.string().min(1) },
  outputSchema: { employeeId: z.string(), endedAt: z.number(), durationMs: z.number() },
})
export default class RegisterExitTool extends ToolContext {
  async execute(input: { employeeId: string; siteId: string }) {
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
    const closed = await redis.closeSession(siteId, employeeId, openStartStr, segments);
    if (!closed) {
      throw new Error(`The open session of employee ${employeeId} at site ${siteId} was closed by another request`);
    }
    const total = segments.reduce((sum, seg) => sum + seg.durationMs, 0);

    return { employeeId, endedAt: end, durationMs: total };
  }
}

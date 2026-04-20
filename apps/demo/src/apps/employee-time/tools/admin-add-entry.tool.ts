import { z } from '@frontmcp/lazy-zod';
import { Tool, ToolContext } from '@frontmcp/sdk';

import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import EmployeeRedisProvider from '../providers/redis.provider';
import { openKey as siteOpenKey } from '../utils/keys';
import { toMs } from '../utils/time';

@Tool({
  name: 'admin-add-entry',
  description: 'Admin: add an entry (start) for an employee at a specific time for a site',
  inputSchema: {
    admin: z.boolean().refine((v) => v === true, 'Admin privileges required'),
    employeeId: z.string().min(1),
    siteId: z.string().min(1),
    at: z.union([z.number(), z.string()]),
  },
  outputSchema: z.object({
    employeeId: z.string(),
    startedAt: z.number(),
  }),
})
export default class AdminAddEntryTool extends ToolContext {
  async execute(input: { admin: boolean; employeeId: string; siteId: string; at: number | string }) {
    const redis = this.get(EmployeeRedisProvider);
    const dir = this.get(EmployeeDirectoryProvider);
    const { employeeId, siteId } = input;
    const startedAt = toMs(input.at);

    const openKey = siteOpenKey(siteId, employeeId);
    const exists = await redis.exists(openKey);
    if (exists) {
      throw new Error(`Employee ${employeeId} already has an open session at site ${siteId}`);
    }

    await redis.set(openKey, String(startedAt));
    await dir.addEmployeeToSite(employeeId, siteId);

    return { employeeId, startedAt };
  }
}

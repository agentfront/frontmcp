import {Tool, ToolContext} from '@frontmcp/sdk';
import {z} from 'zod';
import EmployeeRedisProvider from '../providers/redis.provider';
import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import {openKey as siteOpenKey} from '../utils/keys';

function nowMs() { return Date.now(); }

@Tool({
  name: 'register-entry',
  description: 'Register start of a work session for an employee (now) at a site',
  inputSchema: { employeeId: z.string().min(1), siteId: z.string().min(1) },
  outputSchema: { employeeId: z.string(), startedAt: z.number()}
})
export default class RegisterEntryTool extends ToolContext {
  async execute(input: { employeeId: string, siteId: string }) {
    const redis = this.get(EmployeeRedisProvider);
    const dir = this.get(EmployeeDirectoryProvider);
    const { employeeId, siteId } = input;

    const openKey = siteOpenKey(siteId, employeeId);
    const exists = await redis.exists(openKey);
    if (exists) {
      throw new Error(`Employee ${employeeId} already has an open session at site ${siteId}`);
    }

    const startedAt = nowMs();
    await redis.set(openKey, String(startedAt));
    await dir.addEmployeeToSite(employeeId, siteId);

    return { employeeId, startedAt };
  }
}

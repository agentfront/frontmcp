import {Tool, ToolContext} from '@frontmcp/sdk';
import {z} from 'zod';
import EmployeeDirectoryProvider from '../providers/employee-directory.provider';

@Tool({
  name: 'list-employees',
  description: 'List employees, optionally filtered by site, with pagination',
  inputSchema: {
    siteId: z.string().min(1).optional(),
    search: z.string().optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  outputSchema: {} as any,
})
export default class ListEmployeesTool extends ToolContext {
  async execute(input: { siteId?: string; search?: string; offset?: number; limit?: number }) {
    const dir = this.get(EmployeeDirectoryProvider);
    const { total, items } = await dir.listEmployees({ siteId: input.siteId, search: input.search, offset: input.offset, limit: input.limit });

    const withSites = await Promise.all(items.map(async (employeeId) => {
      const sites = await dir.listSitesForEmployee(employeeId);
      return { employeeId, sites };
    }));

    return {
      result: {
        total,
        items: withSites,
        page: {
          offset: input.offset ?? 0,
          limit: Math.min(200, Math.max(1, input.limit ?? 50)),
        },
      }
    };
  }
}

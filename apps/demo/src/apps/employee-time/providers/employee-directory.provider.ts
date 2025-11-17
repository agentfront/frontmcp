import { AsyncProvider, ProviderScope } from '@frontmcp/sdk';
import EmployeeRedisProvider from './redis.provider';
import { SITES_SET, siteEmployeesSetKey, employeeSitesSetKey } from '../utils/keys';

export default class EmployeeDirectoryProvider {
  constructor(private readonly redis: EmployeeRedisProvider) {}

  async addEmployeeToSite(employeeId: string, siteId: string): Promise<void> {
    await this.redis.sadd(SITES_SET, siteId);
    await this.redis.sadd(siteEmployeesSetKey(siteId), employeeId);
    await this.redis.sadd(employeeSitesSetKey(employeeId), siteId);
  }

  async removeEmployeeFromSite(employeeId: string, siteId: string): Promise<void> {
    // ioredis sadd returns number; we don't need it here. No srem helper so reuse client via redis as any
    const client: any = (this.redis as any).client;
    if (client?.srem) {
      await client.srem(siteEmployeesSetKey(siteId), employeeId);
      await client.srem(employeeSitesSetKey(employeeId), siteId);
    }
  }

  async listSites(): Promise<string[]> {
    return this.redis.smembers(SITES_SET);
  }

  async listSitesForEmployee(employeeId: string): Promise<string[]> {
    return this.redis.smembers(employeeSitesSetKey(employeeId));
  }

  async listEmployees(opts?: {
    siteId?: string;
    offset?: number;
    limit?: number;
    search?: string;
  }): Promise<{ total: number; items: string[] }> {
    const offset = Math.max(0, opts?.offset ?? 0);
    const limit = Math.min(200, Math.max(1, opts?.limit ?? 50));

    let all: string[] = [];
    if (opts?.siteId) {
      all = await this.redis.smembers(siteEmployeesSetKey(opts.siteId));
    } else {
      const sites = await this.listSites();
      const set = new Set<string>();
      for (const s of sites) {
        const members = await this.redis.smembers(siteEmployeesSetKey(s));
        for (const m of members) set.add(m);
      }
      all = Array.from(set);
    }

    if (opts?.search) {
      const q = opts.search.toLowerCase();
      all = all.filter((id) => id.toLowerCase().includes(q));
    }

    const total = all.length;
    const items = all.sort().slice(offset, offset + limit);
    return { total, items };
  }
}

export const createEmployeeDirectoryProvider = AsyncProvider({
  provide: EmployeeDirectoryProvider,
  name: 'EmployeeDirectoryProvider',
  scope: ProviderScope.GLOBAL,
  inject: () => [EmployeeRedisProvider] as const,
  useFactory: async (redis) => new EmployeeDirectoryProvider(redis),
});

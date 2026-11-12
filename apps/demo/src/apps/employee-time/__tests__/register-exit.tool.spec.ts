import EmployeeDirectoryProvider from '../providers/employee-directory.provider';
import EmployeeRedisProvider from '../providers/redis.provider';
import RegisterExitTool from '../tools/register-exit.tool';
import { hoursKey, openKey } from '../utils/keys';
import { type SessionSegment } from '../utils/time';

/** An in-memory stand-in for EmployeeRedisProvider; each command yields once, as a network call would. */
class InMemoryRedis {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    await Promise.resolve();
    return this.values.get(key) ?? null;
  }

  async incrBy(key: string, amount: number): Promise<number> {
    await Promise.resolve();
    const total = Number(this.values.get(key) ?? 0) + amount;
    this.values.set(key, String(total));
    return total;
  }

  async lpush(): Promise<number> {
    await Promise.resolve();
    return 1;
  }

  async del(key: string): Promise<void> {
    await Promise.resolve();
    this.values.delete(key);
  }

  /** Applies the whole close at once, as the provider's Redis script does. */
  async closeSession(
    siteId: string,
    employeeId: string,
    openStart: string,
    segments: SessionSegment[],
  ): Promise<boolean> {
    await Promise.resolve();
    if (this.values.get(openKey(siteId, employeeId)) !== openStart) return false;
    for (const segment of segments) {
      const key = hoursKey(siteId, employeeId, segment.day);
      this.values.set(key, String(Number(this.values.get(key) ?? 0) + segment.durationMs));
    }
    this.values.delete(openKey(siteId, employeeId));
    return true;
  }
}

/** A register-exit tool whose providers are the given in-memory stand-ins. */
function exitTool(redis: InMemoryRedis): RegisterExitTool {
  const directory = { addEmployeeToSite: async () => undefined };
  const tool = Object.create(RegisterExitTool.prototype) as RegisterExitTool;
  Object.defineProperty(tool, 'get', {
    value: (token: unknown) =>
      token === EmployeeRedisProvider ? redis : token === EmployeeDirectoryProvider && directory,
  });
  return tool;
}

describe('register-exit', () => {
  it('records an open session once when two exits for it run at the same time', async () => {
    const redis = new InMemoryRedis();
    redis.values.set(openKey('s1', 'e1'), String(Date.now() - 60 * 60 * 1000));

    const results = await Promise.allSettled([
      exitTool(redis).execute({ employeeId: 'e1', siteId: 's1' }),
      exitTool(redis).execute({ employeeId: 'e1', siteId: 's1' }),
    ]);

    const recorded = results.filter((result) => result.status === 'fulfilled');
    expect(recorded).toHaveLength(1);
    const hoursTotal = [...redis.values.entries()]
      .filter(([key]) => key.startsWith('et:hours:'))
      .reduce((sum, [, value]) => sum + Number(value), 0);
    expect(hoursTotal).toBe((recorded[0] as PromiseFulfilledResult<{ durationMs: number }>).value.durationMs);
    expect(redis.values.has(openKey('s1', 'e1'))).toBe(false);
  });
});

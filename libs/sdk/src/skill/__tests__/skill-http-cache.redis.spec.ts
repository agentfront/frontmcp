/**
 * The Redis-backed skills HTTP cache on a single node, a cluster, and the app's own client (#1503):
 * keys are found with SCAN (on every master of a cluster), never KEYS.
 */
import { createSkillHttpCache } from '../cache/skill-http-cache.factory';

function master(keys: string[]) {
  return { scan: jest.fn().mockResolvedValue(['0', keys]) };
}

function appCluster(masters: ReturnType<typeof master>[]) {
  return {
    status: 'ready',
    isCluster: true,
    call: jest.fn(),
    sendCommand: jest.fn(),
    duplicate: jest.fn(),
    nodes: jest.fn(() => masters),
    ping: jest.fn().mockResolvedValue('PONG'),
    connect: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn(),
    setex: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    keys: jest.fn(),
    scan: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  };
}

describe('createSkillHttpCache on Redis', () => {
  it("uses the app's own cluster without connecting it, and scans every master to invalidate", async () => {
    const client = appCluster([master(['skills:llm.txt', 'skills:list:a']), master(['skills:skill:x'])]);
    const { cache, type } = await createSkillHttpCache({
      redis: { provider: 'redis', client },
      keyPrefix: 'skills:',
    });

    expect(type).toBe('redis');
    expect(client.connect).not.toHaveBeenCalled();

    await cache.invalidateAll();

    expect(client.keys).not.toHaveBeenCalled();
    // One DEL per key: the keys span hash slots
    expect(client.del.mock.calls).toEqual([['skills:llm.txt'], ['skills:list:a'], ['skills:skill:x']]);

    await cache.dispose();
    expect(client.quit).not.toHaveBeenCalled();
  });

  it('scans list keys when one skill is invalidated', async () => {
    const client = appCluster([master(['skills:list:a']), master(['skills:list:b'])]);
    const { cache } = await createSkillHttpCache({ redis: { provider: 'redis', client }, keyPrefix: 'skills:' });

    await cache.invalidateSkill('x');

    const deleted = client.del.mock.calls.map(([key]) => key).sort();
    expect(deleted).toEqual([
      'skills:list:a',
      'skills:list:b',
      'skills:llm.txt',
      'skills:llm_full.txt',
      'skills:skill:x',
    ]);
  });
});

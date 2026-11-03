/**
 * The job stores open `jobs.store.redis` with a Redis client, so a Vercel KV one connected to localhost. A server
 * whose `jobs.store.redis` is Vercel KV now refuses to start, in server and CLI mode; a top-level Vercel KV is passed
 * over, and the runs stay in memory.
 */
import 'reflect-metadata';

import { App, LogLevel, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';

const createRedisClient = jest.fn();

jest.mock('@frontmcp/utils', () => ({
  ...jest.requireActual('@frontmcp/utils'),
  createRedisClient: (options: unknown) => createRedisClient(options),
}));

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

const configOf = (options: Record<string, unknown>) =>
  ({
    info: { name: 'job-store-vercel-kv', version: '1.0.0' },
    apps: [EmptyApp],
    logging: { level: LogLevel.Off },
    ...options,
  }) as FrontMcpConfigInput;

describe('a server whose jobs would use Vercel KV', () => {
  beforeEach(() => createRedisClient.mockReset());

  it.each([
    ['server', undefined],
    ['CLI', 'cli' as const],
  ])('refuses a Vercel KV jobs.store.redis in %s mode, and connects to no Redis', async (_mode, mode) => {
    const config = configOf({ jobs: { enabled: true, store: { redis: { provider: 'vercel-kv' } } } });

    await expect(connect(config, { mode })).rejects.toThrow(
      expect.objectContaining({ name: 'JobStoreNotSupportedError' }),
    );
    expect(createRedisClient).not.toHaveBeenCalled();
  });

  it('keeps the runs in memory beside a top-level Vercel KV', async () => {
    const config = configOf({ redis: { provider: 'vercel-kv' }, jobs: { enabled: true } });

    const client = await connect(config, { mode: 'cli' });
    await client.close();

    expect(createRedisClient).not.toHaveBeenCalled();
  });
});

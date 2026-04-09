/**
 * Redis Test Container
 *
 * Starts a Redis container via testcontainers for distributed E2E tests.
 * Skips when Docker is not available or SKIP_REDIS_TESTS=1 is set.
 */

import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export interface RedisContainerInfo {
  /** Redis host (usually localhost) */
  host: string;
  /** Mapped Redis port */
  port: number;
  /** Full Redis URL: redis://host:port */
  url: string;
  /** Stop the container */
  stop: () => Promise<void>;
}

const REDIS_IMAGE = 'redis:7-alpine';
const REDIS_PORT = 6379;

/**
 * Start a Redis container for testing.
 *
 * @returns Container info with host, port, url, and stop function
 * @throws When Docker is not available
 */
export async function startRedisContainer(): Promise<RedisContainerInfo> {
  const container: StartedTestContainer = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(REDIS_PORT)
    .withStartupTimeout(30_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(REDIS_PORT);

  return {
    host,
    port,
    url: `redis://${host}:${port}`,
    stop: async () => {
      await container.stop({ timeout: 30_000 });
    },
  };
}

/**
 * Check if distributed tests should be skipped.
 * Returns true if SKIP_REDIS_TESTS=1 or SKIP_DISTRIBUTED_TESTS=1.
 */
export function shouldSkipDistributedTests(): boolean {
  return process.env['SKIP_REDIS_TESTS'] === '1' || process.env['SKIP_DISTRIBUTED_TESTS'] === '1';
}

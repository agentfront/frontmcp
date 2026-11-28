import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { DistributedApp } from './apps/distributed-app';
import { QuestionsApp } from './apps/questions-app';

const port = parseInt(process.env['PORT'] ?? '3200', 10);
const redisUrl = new URL(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
// REDIS_CLUSTER=1: the same endpoint as a Redis Cluster (`cluster: true`), as in main.ts
const redis = {
  provider: 'redis' as const,
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379', 10),
  ...(process.env['REDIS_CLUSTER'] === '1' ? { cluster: true as const } : {}),
};

/** main.ts with persistent questions, kept in the same Redis, and the inbox where a person answers them. */
@FrontMcp({
  info: { name: 'Demo E2E Distributed', version: '0.1.0' },
  apps: [DistributedApp, QuestionsApp],
  logging: { level: LogLevel.Warn },
  http: { port, auth: { people: 'loopback-token' } },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
  transport: { protocol: 'modern', persistence: { redis, defaultTtlMs: 300_000 } },
  redis,
  elicitation: { enabled: true, persistent: { inboxLinks: 'stderr' } },
})
export default class Server {}

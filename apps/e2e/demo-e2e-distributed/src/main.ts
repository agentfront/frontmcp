import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { DistributedApp } from './apps/distributed-app';

const port = parseInt(process.env['PORT'] ?? '3200', 10);
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// Parse redis URL into host/port
const redisUrlParsed = new URL(redisUrl);

@FrontMcp({
  info: { name: 'Demo E2E Distributed', version: '0.1.0' },
  apps: [DistributedApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: 'modern',
    persistence: {
      redis: {
        provider: 'redis',
        host: redisUrlParsed.hostname,
        port: parseInt(redisUrlParsed.port || '6379', 10),
      },
      defaultTtlMs: 300_000,
    },
  },
  redis: {
    provider: 'redis',
    host: redisUrlParsed.hostname,
    port: parseInt(redisUrlParsed.port || '6379', 10),
  },
})
export default class Server {}

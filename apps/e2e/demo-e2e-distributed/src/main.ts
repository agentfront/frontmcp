import { Cluster } from 'ioredis';
import { createCluster } from 'redis';

import { FrontMcp, LogLevel, type RedisOptionsInput } from '@frontmcp/sdk';

import { DistributedApp } from './apps/distributed-app';

const port = parseInt(process.env['PORT'] ?? '3200', 10);
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

// Parse redis URL into host/port
const redisUrlParsed = new URL(redisUrl);
const host = redisUrlParsed.hostname;
const redisPort = parseInt(redisUrlParsed.port || '6379', 10);

/**
 * The Redis this node uses (#1503):
 * - default: the host/port of REDIS_URL, a single node;
 * - REDIS_CLUSTER=1: the same endpoint with `cluster: true` (a Redis Cluster endpoint);
 * - REDIS_CLIENT=ioredis | node-redis: a cluster client the app makes itself, passed as `client`.
 */
function redisOption(): RedisOptionsInput {
  // A client the app makes is the app's to listen to: FrontMCP attaches no listener to it
  const logError = (error: unknown) => console.error('[redis]', error);
  switch (process.env['REDIS_CLIENT']) {
    case 'ioredis':
      return { client: new Cluster([{ host, port: redisPort }]).on('error', logError) };
    case 'node-redis': {
      const client = createCluster({ rootNodes: [{ url: `redis://${host}:${redisPort}` }] });
      client.on('error', logError);
      return { client };
    }
    default:
      return process.env['REDIS_CLUSTER'] === '1'
        ? { provider: 'redis', host, port: redisPort, cluster: true }
        : { provider: 'redis', host, port: redisPort };
  }
}

const redis = redisOption();

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
      redis,
      defaultTtlMs: 300_000,
    },
  },
  redis,
})
export default class Server {}

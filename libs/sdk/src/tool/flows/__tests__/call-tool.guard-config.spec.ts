import 'reflect-metadata';

import type { ConcurrencyConfig, RateLimitConfig, TimeoutConfig } from '@frontmcp/guard';

import {
  createTestFetchServer,
  rpc20260728,
  type Rpc20260728Response,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../../common';
import type { WebFetchHandler } from '../../../transport/web-fetch-handler';

interface ToolGuardOptions {
  rateLimit?: RateLimitConfig;
  concurrency?: ConcurrencyConfig;
  timeout?: TimeoutConfig;
}

interface GuardedServer {
  handler: WebFetchHandler;
  toolName: string;
  tracker: { running: number; maxRunning: number };
}

let guardedServerCount = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function createGuardedServer(
  toolGuard: ToolGuardOptions,
  throttle: FrontMcpConfigInput['throttle'],
  workMs = 0,
): Promise<GuardedServer> {
  guardedServerCount += 1;
  const toolName = `guarded_${guardedServerCount}`;
  const tracker = { running: 0, maxRunning: 0 };

  @Tool({ name: toolName, inputSchema: {}, ...toolGuard })
  class GuardedTool extends ToolContext {
    async execute() {
      tracker.running += 1;
      tracker.maxRunning = Math.max(tracker.maxRunning, tracker.running);
      await sleep(workMs);
      tracker.running -= 1;
      return { ok: true };
    }
  }

  @App({ id: `guarded-app-${guardedServerCount}`, name: `guarded-app-${guardedServerCount}`, tools: [GuardedTool] })
  class GuardedApp {}

  const { handler } = await createTestFetchServer({
    info: { name: `guard-config-${guardedServerCount}`, version: '1.0.0' },
    apps: [GuardedApp],
    throttle,
  });
  return { handler, toolName, tracker };
}

function outcomeOf({ status, message }: Rpc20260728Response): string {
  if (message.error) return `http ${status} jsonrpc ${message.error.code}`;
  const result = message.result as { isError?: boolean; _meta?: { code?: string } };
  return result.isError ? String(result._meta?.code) : 'ok';
}

function callTool(server: GuardedServer) {
  return rpc20260728(server.handler, 'tools/call', { name: server.toolName, arguments: {} });
}

async function callSequentially(server: GuardedServer, count: number): Promise<string[]> {
  const outcomes: string[] = [];
  for (let index = 0; index < count; index++) {
    outcomes.push(outcomeOf(await callTool(server)));
  }
  return outcomes;
}

async function callInParallel(server: GuardedServer, count: number): Promise<string[]> {
  const responses = await Promise.all(Array.from({ length: count }, () => callTool(server)));
  return responses.map(outcomeOf);
}

describe('call-tool guard configuration', () => {
  describe('settings', () => {
    it('enforces a per-tool rateLimit without a throttle option', async () => {
      const server = await createGuardedServer({ rateLimit: { maxRequests: 2, windowMs: 60_000 } }, undefined);

      const outcomes = await callSequentially(server, 4);

      expect(outcomes).toEqual(['ok', 'ok', 'RATE_LIMIT_EXCEEDED', 'RATE_LIMIT_EXCEEDED']);
    });

    it('leaves a per-tool rateLimit unenforced when throttle.enabled is explicitly false', async () => {
      const server = await createGuardedServer({ rateLimit: { maxRequests: 1, windowMs: 60_000 } }, { enabled: false });

      const outcomes = await callSequentially(server, 3);

      expect(outcomes).toEqual(['ok', 'ok', 'ok']);
    });

    it('enforces a per-tool concurrency limit without throttle.enabled', async () => {
      const server = await createGuardedServer({ concurrency: { maxConcurrent: 1 } }, undefined, 150);

      await callInParallel(server, 3);

      expect(server.tracker.maxRunning).toBe(1);
    });

    it('applies throttle.defaultConcurrency to a tool without its own concurrency limit', async () => {
      const server = await createGuardedServer({}, { enabled: true, defaultConcurrency: { maxConcurrent: 1 } }, 150);

      await callInParallel(server, 3);

      expect(server.tracker.maxRunning).toBe(1);
    });

    it('applies throttle.globalConcurrency across tool calls', async () => {
      const server = await createGuardedServer({}, { enabled: true, globalConcurrency: { maxConcurrent: 1 } }, 150);

      await callInParallel(server, 3);

      expect(server.tracker.maxRunning).toBe(1);
    });

    it('counts each tools/call once against throttle.global', async () => {
      const server = await createGuardedServer({}, { enabled: true, global: { maxRequests: 4, windowMs: 60_000 } });

      const outcomes = await callSequentially(server, 5);

      expect(outcomes.slice(0, 4)).toEqual(['ok', 'ok', 'ok', 'ok']);
      expect(outcomes[4]).not.toBe('ok');
    });
  });

  describe('partitions', () => {
    it('keys a session-partitioned throttle.global on a verified session, not the session header', async () => {
      const server = await createGuardedServer(
        {},
        { enabled: true, global: { maxRequests: 2, windowMs: 60_000, partitionBy: 'session' } },
      );

      const outcomes: string[] = [];
      for (const forgedSessionId of ['forged-1', 'forged-2', 'forged-3']) {
        const response = await rpc20260728(
          server.handler,
          'tools/call',
          { name: server.toolName, arguments: {} },
          { headers: { 'mcp-session-id': forgedSessionId } },
        );
        outcomes.push(outcomeOf(response));
      }

      expect(outcomes.slice(0, 2)).toEqual(['ok', 'ok']);
      expect(outcomes[2]).not.toBe('ok');
    });
  });

  describe('error codes', () => {
    it('answers a reached concurrency limit with CONCURRENCY_LIMIT', async () => {
      const server = await createGuardedServer({ concurrency: { maxConcurrent: 1 } }, { enabled: true }, 150);

      const outcomes = await callInParallel(server, 3);

      expect(outcomes).toContain('CONCURRENCY_LIMIT');
    });

    it('answers a queue timeout with QUEUE_TIMEOUT', async () => {
      const server = await createGuardedServer(
        { concurrency: { maxConcurrent: 1, queueTimeoutMs: 50 } },
        { enabled: true },
        200,
      );

      const outcomes = await callInParallel(server, 3);

      expect(outcomes).toContain('QUEUE_TIMEOUT');
    });

    it('answers an execution timeout with EXECUTION_TIMEOUT', async () => {
      const server = await createGuardedServer({ timeout: { executeMs: 50 } }, { enabled: true }, 200);

      const outcomes = await callSequentially(server, 1);

      expect(outcomes).toEqual(['EXECUTION_TIMEOUT']);
    });
  });
});

import 'reflect-metadata';

import { z } from 'zod';

import { App, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

const messageSchema = { message: z.string().default('hello') };
const delaySchema = { delayMs: z.number().default(0) };
const valueSchema = { value: z.string().default('test') };

@Tool({
  name: 'rate-limited',
  description: 'A rate-limited echo tool',
  inputSchema: messageSchema,
  rateLimit: { maxRequests: 3, windowMs: 5000, partitionBy: 'global' },
})
class RateLimitedTool extends ToolContext {
  async execute(input: { message: string }) {
    return { echo: input.message };
  }
}

@Tool({
  name: 'timeout-tool',
  description: 'A tool with a 500ms timeout',
  inputSchema: delaySchema,
  timeout: { executeMs: 500 },
})
class TimeoutTool extends ToolContext {
  async execute(input: { delayMs: number }) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}

@Tool({
  name: 'unguarded',
  description: 'An unguarded echo tool',
  inputSchema: valueSchema,
})
class UnguardedTool extends ToolContext {
  async execute(input: { value: string }) {
    return { echo: input.value };
  }
}

@Tool({
  name: 'concurrency-mutex',
  description: 'A mutex tool',
  inputSchema: delaySchema,
  concurrency: { maxConcurrent: 1, queueTimeoutMs: 0 },
})
class ConcurrencyMutexTool extends ToolContext {
  async execute(input: { delayMs: number }) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}

@Tool({
  name: 'concurrency-queued',
  description: 'A queued mutex tool',
  inputSchema: delaySchema,
  concurrency: { maxConcurrent: 1, queueTimeoutMs: 3000 },
})
class ConcurrencyQueuedTool extends ToolContext {
  async execute(input: { delayMs: number }) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}

@Tool({
  name: 'combined-guard',
  description: 'A tool with all guards',
  inputSchema: delaySchema,
  rateLimit: { maxRequests: 5, windowMs: 5000, partitionBy: 'global' },
  concurrency: { maxConcurrent: 2, queueTimeoutMs: 1000 },
  timeout: { executeMs: 2000 },
})
class CombinedGuardTool extends ToolContext {
  async execute(input: { delayMs: number }) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { status: 'done' };
  }
}

@Tool({
  name: 'slow-tool',
  description: 'A slow tool',
  inputSchema: delaySchema,
})
class SlowTool extends ToolContext {
  async execute(input: { delayMs: number }) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { completedAfterMs: input.delayMs };
  }
}

@App({
  name: 'guard-cli',
  description: 'Guard CLI testing tools',
  tools: [
    RateLimitedTool,
    ConcurrencyMutexTool,
    ConcurrencyQueuedTool,
    TimeoutTool,
    CombinedGuardTool,
    UnguardedTool,
    SlowTool,
  ],
})
class GuardCliApp {}

const serverConfig = {
  info: { name: 'Guard CLI E2E Demo', version: '1.0.0' },
  apps: [GuardCliApp],
  logging: { level: LogLevel.Warn, enableConsole: false },
  auth: { mode: 'public' as const },
  http: { port: 50409 },
  throttle: {
    enabled: true,
    global: { maxRequests: 200, windowMs: 10_000, partitionBy: 'global' as const },
    defaultTimeout: { executeMs: 5000 },
  },
};

export default serverConfig;

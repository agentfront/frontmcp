import 'reflect-metadata';
import { z } from 'zod';
import { Tool, ToolContext } from '../../';

describe('Tool decorator guard config validation', () => {
  it('should accept valid concurrency config', () => {
    expect(() => {
      @Tool({
        name: 'valid-concurrency',
        inputSchema: { query: z.string() },
        concurrency: { maxConcurrent: 5 },
      })
      class ValidTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return ValidTool;
    }).not.toThrow();
  });

  it('should accept valid rateLimit config', () => {
    expect(() => {
      @Tool({
        name: 'valid-rate-limit',
        inputSchema: { query: z.string() },
        rateLimit: { maxRequests: 100, windowMs: 60_000 },
      })
      class ValidTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return ValidTool;
    }).not.toThrow();
  });

  it('should accept valid timeout config', () => {
    expect(() => {
      @Tool({
        name: 'valid-timeout',
        inputSchema: { query: z.string() },
        timeout: { executeMs: 30_000 },
      })
      class ValidTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return ValidTool;
    }).not.toThrow();
  });

  it('should accept tool with all guard configs', () => {
    expect(() => {
      @Tool({
        name: 'all-guards',
        inputSchema: { query: z.string() },
        concurrency: { maxConcurrent: 3, queueTimeoutMs: 5000 },
        rateLimit: { maxRequests: 50, windowMs: 30_000 },
        timeout: { executeMs: 10_000 },
      })
      class AllGuardsTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return AllGuardsTool;
    }).not.toThrow();
  });

  it('should accept tool with no guard config', () => {
    expect(() => {
      @Tool({
        name: 'no-guards',
        inputSchema: { query: z.string() },
      })
      class SimpleTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return SimpleTool;
    }).not.toThrow();
  });

  it('should reject concurrency config missing maxConcurrent at runtime', () => {
    expect(() => {
      @Tool({
        name: 'bad-concurrency',
        inputSchema: { query: z.string() },
        concurrency: {},
      })
      class BadTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return BadTool;
    }).toThrow();
  });

  it('should reject rateLimit config missing maxRequests at runtime', () => {
    expect(() => {
      @Tool({
        name: 'bad-rate-limit',
        inputSchema: { query: z.string() },
        rateLimit: {},
      })
      class BadTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return BadTool;
    }).toThrow();
  });

  it('should reject timeout config missing executeMs at runtime', () => {
    expect(() => {
      @Tool({
        name: 'bad-timeout',
        inputSchema: { query: z.string() },
        timeout: {},
      })
      class BadTool extends ToolContext {
        async execute(input: { query: string }) {
          return { result: input.query };
        }
      }
      return BadTool;
    }).toThrow();
  });
});

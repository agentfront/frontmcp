import 'reflect-metadata';
import { z } from 'zod';
import { Tool, ToolContext } from '../../';

// ════════════════════════════════════════════════════════════════
// Type-level tests: verified by `nx typecheck sdk`
//
// Each [ts-expect-error] MUST correspond to an actual type error.
// If the error disappears (regression), tsc will flag it as
// unused, failing the typecheck.
//
// Invalid decorator usages are wrapped in never-called functions
// to prevent Zod runtime validation errors while still being
// type-checked by TypeScript.
// ════════════════════════════════════════════════════════════════

// ── Valid: inputSchema only (no outputSchema) ────────────────

@Tool({ name: 'valid-input-only', inputSchema: { query: z.string() } })
class ValidInputOnly extends ToolContext {
  async execute(input: { query: string }) {
    return { result: input.query };
  }
}

// ── Valid: inputSchema + outputSchema ────────────────────────

@Tool({
  name: 'valid-with-output',
  inputSchema: { a: z.number(), b: z.number() },
  outputSchema: { result: z.number() },
})
class ValidWithOutput extends ToolContext {
  async execute(input: { a: number; b: number }) {
    return { result: input.a + input.b };
  }
}

// ── Valid: with guard configs ────────────────────────────────

@Tool({
  name: 'valid-guards',
  inputSchema: { query: z.string() },
  concurrency: { maxConcurrent: 5 },
  rateLimit: { maxRequests: 100, windowMs: 60_000 },
  timeout: { executeMs: 30_000 },
})
class ValidWithGuards extends ToolContext {
  async execute(input: { query: string }) {
    return { result: input.query };
  }
}

// ── Invalid: concurrency typo ───────────────────────────────

function _testInvalidConcurrency() {
  // @ts-expect-error - decorator fails: invalid concurrency property cascades to unresolvable signature
  @Tool({
    name: 'bad-concurrency',
    inputSchema: { query: z.string() },
    concurrency: {
      // @ts-expect-error - 'maxConcurrensst' does not exist on ConcurrencyConfigInput
      maxConcurrensst: 5,
    },
  })
  class BadConcurrency extends ToolContext {
    async execute(input: { query: string }) {
      return {};
    }
  }
  void BadConcurrency;
}

// ── Invalid: rateLimit typo ─────────────────────────────────

function _testInvalidRateLimit() {
  // @ts-expect-error - decorator fails: invalid rateLimit property cascades to unresolvable signature
  @Tool({
    name: 'bad-rate-limit',
    inputSchema: { query: z.string() },
    rateLimit: {
      // @ts-expect-error - 'maxRequestss' does not exist on RateLimitConfigInput
      maxRequestss: 100,
    },
  })
  class BadRateLimit extends ToolContext {
    async execute(input: { query: string }) {
      return {};
    }
  }
  void BadRateLimit;
}

// ── Invalid: wrong execute() param type ─────────────────────

function _testWrongParamType() {
  // @ts-expect-error - execute() param { query: number } does not match input schema { query: string }
  @Tool({
    name: 'wrong-param',
    inputSchema: { query: z.string() },
  })
  class WrongParamType extends ToolContext {
    async execute(input: { query: number }) {
      return {};
    }
  }
  void WrongParamType;
}

// ── Invalid: wrong execute() return type with outputSchema ──

function _testWrongReturnType() {
  // @ts-expect-error - execute() returns { result: string } but outputSchema expects { result: number }
  @Tool({
    name: 'wrong-return',
    inputSchema: { query: z.string() },
    outputSchema: { result: z.number() },
  })
  class WrongReturnType extends ToolContext {
    async execute(input: { query: string }) {
      return { result: 'not-a-number' };
    }
  }
  void WrongReturnType;
}

// ── Invalid: class not extending ToolContext ─────────────────

function _testNotToolContext() {
  // @ts-expect-error - class must extend ToolContext
  @Tool({
    name: 'not-tool-context',
    inputSchema: { query: z.string() },
  })
  class NotToolContext {
    async execute(input: { query: string }) {
      return {};
    }
  }
  void NotToolContext;
}

// Suppress unused variable/function warnings
void ValidInputOnly;
void ValidWithOutput;
void ValidWithGuards;
void _testInvalidConcurrency;
void _testInvalidRateLimit;
void _testWrongParamType;
void _testWrongReturnType;
void _testNotToolContext;

// ════════════════════════════════════════════════════════════════
// Runtime placeholder (required by Jest)
// ════════════════════════════════════════════════════════════════

describe('Tool decorator type safety', () => {
  it('type assertions are verified by tsc --noEmit (nx typecheck sdk)', () => {
    expect(true).toBe(true);
  });
});

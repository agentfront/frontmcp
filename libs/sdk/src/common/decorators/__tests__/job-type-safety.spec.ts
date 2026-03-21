import 'reflect-metadata';
import { z } from 'zod';
import { Job, JobContext } from '../../';

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

// ── Valid: job with inputSchema + outputSchema ──────────────

@Job({
  name: 'valid-job',
  inputSchema: { data: z.string() },
  outputSchema: { result: z.string() },
})
class ValidJob extends JobContext {
  async execute(input: { data: string }) {
    return { result: input.data };
  }
}

// ── Invalid: wrong execute() param type ─────────────────────

function _testWrongParamType() {
  // @ts-expect-error - execute() param { data: number } does not match input schema { data: string }
  @Job({
    name: 'wrong-param-job',
    inputSchema: { data: z.string() },
    outputSchema: { result: z.string() },
  })
  class WrongParamJob extends JobContext {
    async execute(input: { data: number }) {
      return { result: 'ok' };
    }
  }
  void WrongParamJob;
}

// ── Invalid: wrong execute() return type ────────────────────

function _testWrongReturnType() {
  // @ts-expect-error - execute() returns { result: string } but outputSchema expects { result: number }
  @Job({
    name: 'wrong-return-job',
    inputSchema: { data: z.string() },
    outputSchema: { result: z.number() },
  })
  class WrongReturnJob extends JobContext {
    async execute(input: { data: string }) {
      return { result: 'not-a-number' };
    }
  }
  void WrongReturnJob;
}

// ── Invalid: class not extending JobContext ──────────────────

function _testNotJobContext() {
  // @ts-expect-error - class must extend JobContext
  @Job({
    name: 'not-job-context',
    inputSchema: { data: z.string() },
    outputSchema: { result: z.string() },
  })
  class NotJobContext {
    async execute(input: { data: string }) {
      return { result: input.data };
    }
  }
  void NotJobContext;
}

// Suppress unused variable/function warnings
void ValidJob;
void _testWrongParamType;
void _testWrongReturnType;
void _testNotJobContext;

// ════════════════════════════════════════════════════════════════
// Runtime placeholder (required by Jest)
// ════════════════════════════════════════════════════════════════

describe('Job decorator type safety', () => {
  it('type assertions are verified by tsc --noEmit (nx typecheck sdk)', () => {
    expect(true).toBe(true);
  });
});

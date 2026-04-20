import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { Agent, AgentContext } from '../../';

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

// ── Valid: agent with inputSchema and llm config ────────────

@Agent({
  name: 'valid-agent',
  inputSchema: { topic: z.string() },
  llm: { provider: 'openai', model: 'gpt-4', apiKey: 'test-key' },
})
class ValidAgent extends AgentContext {
  override async execute(input: { topic: string }) {
    return { result: input.topic };
  }
}

// ── Valid: agent with guard configs ──────────────────────────

@Agent({
  name: 'valid-agent-guards',
  inputSchema: { topic: z.string() },
  llm: { provider: 'openai', model: 'gpt-4', apiKey: 'test-key' },
  concurrency: { maxConcurrent: 2 },
  rateLimit: { maxRequests: 10, windowMs: 60_000 },
})
class ValidAgentWithGuards extends AgentContext {
  override async execute(input: { topic: string }) {
    return { result: input.topic };
  }
}

// ── Invalid: concurrency typo ───────────────────────────────

function _testInvalidConcurrency() {
  // @ts-expect-error - decorator fails: invalid concurrency property cascades to unresolvable signature
  @Agent({
    name: 'bad-concurrency-agent',
    inputSchema: { topic: z.string() },
    llm: { provider: 'openai', model: 'gpt-4', apiKey: 'test-key' },
    concurrency: {
      // @ts-expect-error - 'maxConcurrensst' does not exist on ConcurrencyConfigInput
      maxConcurrensst: 5,
    },
  })
  class BadConcurrencyAgent extends AgentContext {
    override async execute(input: { topic: string }) {
      return {};
    }
  }
  void BadConcurrencyAgent;
}

// ── Invalid: wrong execute() param type ─────────────────────

function _testWrongParamType() {
  // @ts-expect-error - execute() param { topic: number } does not match input schema { topic: string }
  @Agent({
    name: 'wrong-param-agent',
    inputSchema: { topic: z.string() },
    llm: { provider: 'openai', model: 'gpt-4', apiKey: 'test-key' },
  })
  class WrongParamAgent extends AgentContext {
    override async execute(input: { topic: number }) {
      return {};
    }
  }
  void WrongParamAgent;
}

// ── Invalid: class not extending AgentContext ───────────────

function _testNotAgentContext() {
  // @ts-expect-error - class must extend AgentContext
  @Agent({
    name: 'not-agent-context',
    inputSchema: { topic: z.string() },
    llm: { provider: 'openai', model: 'gpt-4', apiKey: 'test-key' },
  })
  class NotAgentContext {
    async execute(input: { topic: string }) {
      return {};
    }
  }
  void NotAgentContext;
}

// Suppress unused variable/function warnings
void ValidAgent;
void ValidAgentWithGuards;
void _testInvalidConcurrency;
void _testWrongParamType;
void _testNotAgentContext;

// ════════════════════════════════════════════════════════════════
// Runtime placeholder (required by Jest)
// ════════════════════════════════════════════════════════════════

describe('Agent decorator type safety', () => {
  it('type assertions are verified by tsc --noEmit (nx typecheck sdk)', () => {
    expect(true).toBe(true);
  });
});

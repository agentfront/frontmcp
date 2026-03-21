import 'reflect-metadata';
import { Prompt, PromptContext } from '../../';
import { GetPromptResult } from '@frontmcp/protocol';

// ════════════════════════════════════════════════════════════════
// Type-level tests: verified by `nx typecheck sdk`
//
// Each [ts-expect-error] MUST correspond to an actual type error.
// If the error disappears (regression), tsc will flag it as
// unused, failing the typecheck.
//
// Invalid decorator usages are wrapped in never-called functions
// to prevent runtime errors while still being type-checked.
// ════════════════════════════════════════════════════════════════

// ── Valid: Prompt extending PromptContext ────────────────────

@Prompt({ name: 'valid-prompt', arguments: [{ name: 'topic', required: true }] })
class ValidPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return {
      messages: [{ role: 'user', content: { type: 'text', text: args['topic'] ?? '' } }],
    };
  }
}

// ── Invalid: Prompt class not extending PromptContext ────────

function _testNotPromptContext() {
  // @ts-expect-error - class must extend PromptContext
  @Prompt({ name: 'not-prompt-ctx', arguments: [] })
  class NotPromptContext {
    async execute(args: Record<string, string>): Promise<GetPromptResult> {
      return { messages: [{ role: 'user', content: { type: 'text', text: 'ok' } }] };
    }
  }
  void NotPromptContext;
}

// Suppress unused variable/function warnings
void ValidPrompt;
void _testNotPromptContext;

// ════════════════════════════════════════════════════════════════
// Runtime placeholder (required by Jest)
// ════════════════════════════════════════════════════════════════

describe('Prompt decorator type safety', () => {
  it('type assertions are verified by tsc --noEmit (nx typecheck sdk)', () => {
    expect(true).toBe(true);
  });
});

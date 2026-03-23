import 'reflect-metadata';
import { Resource, ResourceTemplate, ResourceContext } from '../../';
import { ReadResourceResult } from '@frontmcp/protocol';

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

// ── Valid: Resource extending ResourceContext ────────────────

@Resource({ name: 'valid-resource', uri: 'config://app' })
class ValidResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'ok' }] };
  }
}

// ── Valid: ResourceTemplate extending ResourceContext ────────

@ResourceTemplate({
  name: 'valid-template',
  uriTemplate: 'users://{userId}/profile',
})
class ValidTemplate extends ResourceContext<{ userId: string }> {
  async execute(uri: string, params: { userId: string }): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: params.userId }] };
  }
}

// ── Invalid: Resource class not extending ResourceContext ────

function _testNotResourceContext() {
  // @ts-expect-error - class must extend ResourceContext
  @Resource({ name: 'not-resource-ctx', uri: 'bad://resource' })
  class NotResourceContext {
    async execute(uri: string): Promise<ReadResourceResult> {
      return { contents: [{ uri, text: 'ok' }] };
    }
  }
  void NotResourceContext;
}

// ── Invalid: ResourceTemplate class not extending ResourceContext ──

function _testNotResourceTemplateContext() {
  // @ts-expect-error - class must extend ResourceContext
  @ResourceTemplate({ name: 'not-template-ctx', uriTemplate: 'bad://{id}' })
  class NotResourceTemplateContext {
    async execute(uri: string): Promise<ReadResourceResult> {
      return { contents: [{ uri, text: 'ok' }] };
    }
  }
  void NotResourceTemplateContext;
}

// Suppress unused variable/function warnings
void ValidResource;
void ValidTemplate;
void _testNotResourceContext;
void _testNotResourceTemplateContext;

// ════════════════════════════════════════════════════════════════
// Runtime placeholder (required by Jest)
// ════════════════════════════════════════════════════════════════

describe('Resource decorator type safety', () => {
  it('type assertions are verified by tsc --noEmit (nx typecheck sdk)', () => {
    expect(true).toBe(true);
  });
});

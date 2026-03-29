import { Plugin, Provider, DynamicPlugin, ProviderScope } from '@frontmcp/sdk';

// ── Provider ────────────────────────────────────────────────────────────────

@Provider({
  name: 'CounterService',
  scope: ProviderScope.GLOBAL,
})
export class CounterService {
  private count = 0;
  readonly instanceId = `counter-${Math.random().toString(36).substring(2, 10)}`;

  increment(): number {
    return ++this.count;
  }

  getCount(): number {
    return this.count;
  }

  getInstanceId(): string {
    return this.instanceId;
  }
}

// ── Module Augmentation ─────────────────────────────────────────────────────

declare module '@frontmcp/sdk' {
  interface ExecutionContextBase {
    readonly counter: CounterService;
  }
}

// ── Plugin ──────────────────────────────────────────────────────────────────

/**
 * Plugin that provides a CounterService via DI and exposes it as a context
 * extension (`this.counter`).
 *
 * BUG UNDER TEST: When a plugin declares `providers` and `contextExtensions`
 * that reference the same token, the provider must be resolvable from both
 * tools AND resources. If plugin-exported providers are not merged into the
 * resource provider registry, `this.counter` will throw
 * ProviderNotRegisteredError in resource contexts.
 */
@Plugin({
  name: 'counter',
  description: 'Counter plugin with context extension for both tools and resources',
  providers: [CounterService],
  exports: [CounterService],
  contextExtensions: [
    {
      property: 'counter',
      token: CounterService,
      errorMessage: 'CounterPlugin is not installed. Add it to your app plugins.',
    },
  ],
})
export class CounterPlugin extends DynamicPlugin<Record<string, never>> {}

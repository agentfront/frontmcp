// common/types/options/cloud/runtime-context.ts
//
// Default in-memory implementation of `CloudRuntimeContext`. Registered as a
// GLOBAL singleton provider when `cloud` is set on `@FrontMcp()`, so any
// tool/hook/adapter can `@Inject(CloudRuntimeContextToken)` to read values
// the cloud has published (feature flags, login URL, cors allowlist, etc.).

import type { CloudRuntimeContext } from './provider';

export class InMemoryCloudRuntimeContext implements CloudRuntimeContext {
  private readonly store = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  isEnabled(key: string): boolean {
    return Boolean(this.store.get(key));
  }

  set<T = unknown>(key: string, value: T): void {
    this.store.set(key, value);
  }

  merge(values: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(values)) {
      this.store.set(k, v);
    }
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.store.entries());
  }
}

/**
 * DI token for the cloud runtime context. Registered by the SDK when
 * `cloud` is configured; tools/hooks/adapters inject this to read
 * cloud-managed feature flags and config.
 *
 * Uses `Symbol.for` intentionally so that multiple copies of `@frontmcp/sdk`
 * loaded into the same process (e.g. a customer repo that accidentally
 * resolves two SDK versions via transitive deps) still share the same token
 * identity. The tradeoff: any third-party package that imports a cloud
 * plugin must import `CloudRuntimeContextToken` from `@frontmcp/sdk` — never
 * redeclare it locally — or the `Symbol.for` string-lookup will return a
 * DIFFERENT symbol and DI resolution will silently miss.
 *
 * Cross-package interop contract: if you're publishing a cloud provider
 * npm package, import this token from `@frontmcp/sdk` and the host's
 * `runtime.set(...)` / consumer's `get(...)` will line up correctly.
 */
export const CloudRuntimeContextToken = Symbol.for('@frontmcp/sdk:CloudRuntimeContext');

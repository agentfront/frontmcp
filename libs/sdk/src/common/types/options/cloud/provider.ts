// common/types/options/cloud/provider.ts
//
// CloudProvider contract. This is the SDK-owned extension point that cloud
// integrations (Frontegg today, others later) implement to contribute into a
// FrontMcp server's bootstrap. The SDK is agnostic about what any particular
// cloud does — it only provides:
//
//   1. The hook shape (contribute + bootstrap).
//   2. Merge semantics for static contributions (see ./merge.ts).
//   3. A runtime context (CloudRuntimeContext) the cloud can populate with
//      values it fetches over the network (login URL, feature flags, cors
//      allowlist, etc.) and that tools/hooks can read via DI.
//
// A cloud implementation package MUST export a value named `cloudProvider` of
// type `CloudProvider` from its main entry. The SDK lazy-requires the package
// when `cloud` is set on `@FrontMcp()` and calls `contribute()` before scope
// bootstrap and `bootstrap()` after.

import type { AgentChangeEvent } from '../../../../agent/agent.events';
import type { AgentInstance } from '../../../../agent/agent.instance';
import type { PromptChangeEvent } from '../../../../prompt/prompt.events';
import type { ResourceChangeEvent } from '../../../../resource/resource.events';
import type { ToolChangeEvent } from '../../../../tool/tool.events';
import type { PromptEntry } from '../../../entries/prompt.entry';
import type { ResourceEntry } from '../../../entries/resource.entry';
import type { ToolEntry } from '../../../entries/tool.entry';
import type { AppType, PluginType, ProviderType, ResourceType, SkillType, ToolType } from '../../../interfaces';
import type { CloudOptions } from './interfaces';

/**
 * Merge strategy for a single field in `optionsOverride`.
 *
 * - `additive`: arrays are concatenated; objects are shallow-merged.
 * - `override`: cloud value replaces the user value entirely.
 * - `fillGaps`: cloud value is used ONLY when the user didn't set the field.
 *
 * For deep objects (e.g. `cors`), each top-level key of the object inherits
 * the declared strategy. Fine-grained per-key control belongs in the cloud
 * implementation (it can pre-merge before returning).
 */
export type FieldMergeStrategy = 'additive' | 'override' | 'fillGaps';

/**
 * A patch into an existing FrontMcpBaseMetadata field.
 * The cloud declares the strategy; the SDK applies it.
 */
export interface CloudOptionOverride<TValue = unknown> {
  strategy: FieldMergeStrategy;
  value: TValue;
}

/**
 * Static injections produced synchronously at metadata-parse time.
 *
 * Every field is optional. Array fields (plugins, providers, tools, …) are
 * always additive — they append to whatever the user declared. Only
 * `optionsOverride` uses a per-field strategy.
 */
export interface CloudContributions {
  /** Plugins appended to `metadata.plugins`. */
  plugins?: PluginType[];

  /**
   * Adapters appended to `metadata.adapters` (where the SDK supports it).
   * Opaque type — the SDK doesn't enforce a shape beyond "whatever the
   * adapters field takes" in future.
   */
  adapters?: unknown[];

  /** Providers appended to `metadata.providers`. */
  providers?: ProviderType[];

  /** Tools appended to `metadata.tools`. */
  tools?: ToolType[];

  /** Resources appended to `metadata.resources`. */
  resources?: ResourceType[];

  /** Skills appended to `metadata.skills`. */
  skills?: SkillType[];

  /** Apps appended to `metadata.apps`. */
  apps?: AppType[];

  /**
   * Option overrides. Keyed by top-level FrontMcpBaseMetadata field
   * (e.g. `http`, `cors` — when the SDK adds one — `auth`, `throttle`).
   * Each entry declares its own strategy; see `FieldMergeStrategy`.
   */
  optionsOverride?: Record<string, CloudOptionOverride>;
}

/**
 * Shared mutable context populated by the cloud's `bootstrap()` and read by
 * tools/hooks via DI (`CloudRuntimeContextToken`). The cloud is expected to
 * `set()` values it fetches from its backend (feature flags, login URL,
 * tenant-managed cors origins, etc.); consumers read via `get()`.
 *
 * Kept intentionally untyped — each cloud can publish augmentation modules
 * that type-narrow the known keys. The SDK only guarantees the shape.
 */
export interface CloudRuntimeContext {
  /** Returns the stored value for a key or `undefined`. */
  get<T = unknown>(key: string): T | undefined;
  /** Returns true when the value is truthy (handy for feature flags). */
  isEnabled(key: string): boolean;
  /** Replaces the value at `key`. */
  set<T = unknown>(key: string, value: T): void;
  /** Bulk-merge: shallow-merges the payload into the context. */
  merge(values: Record<string, unknown>): void;
  /** Snapshot of the current context (copy). */
  snapshot(): Record<string, unknown>;
}

/**
 * Narrow read/subscribe view of a single registry. Cloud bootstrap gets a
 * `Pick<>`-like surface instead of the full registry class so plugins can't
 * mutate the registry through this path — mutations should happen through
 * the plugin's own providers/hooks, not the bootstrap context.
 */
export interface RegistryView<Entry, Evt> {
  /** Snapshot of every currently-registered entry (global scope). */
  listAllInstances(): readonly Entry[];
  /**
   * Subscribe to change events. When `immediate: true`, a `kind: 'reset'`
   * event fires synchronously with the current snapshot — use it to seed an
   * initial sync on bootstrap.
   */
  subscribe(opts: { immediate?: boolean; filter?: (i: Entry) => boolean }, cb: (evt: Evt) => void): () => void;
}

/**
 * Handles to the running scope's registries, exposed to `bootstrap()` so the
 * cloud can observe the runtime catalog (e.g. push every tool/resource/prompt
 * into an external service, subscribe to changes, and enforce policies).
 *
 * A FrontMCP server can have multiple scopes (split-by-app). For v1 this is
 * the primary scope; multi-scope aggregation is a future extension.
 */
export interface CloudBootstrapRegistries {
  tools: RegistryView<ToolEntry, ToolChangeEvent>;
  resources: RegistryView<ResourceEntry, ResourceChangeEvent>;
  prompts: RegistryView<PromptEntry, PromptChangeEvent>;
  agents: RegistryView<AgentInstance, AgentChangeEvent>;
}

/**
 * Arguments passed to `bootstrap()` — the cloud can register async work,
 * read/write the runtime context, and grab references to SDK providers.
 */
export interface CloudBootstrapContext {
  /** Resolved cloud options (after defaults). */
  options: CloudOptions;
  /** Mutable runtime context shared with DI consumers. */
  runtime: CloudRuntimeContext;
  /** Logger scoped to `cloud:<provider-name>`. */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    debug(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /**
   * Registry handles from the primary scope. Undefined only in legacy test
   * harnesses that build a bootstrap context without a scope — production
   * code paths always populate this field.
   */
  registries?: CloudBootstrapRegistries;
}

/**
 * The contract cloud implementations fulfill. Exported as a named value
 * `cloudProvider` from the package's main entry.
 */
export interface CloudProvider {
  /**
   * Human-readable name of the cloud (e.g. 'frontegg'). Used in log lines
   * and error messages.
   */
  name: string;

  /**
   * Synchronous, static injections applied before scope bootstrap.
   *
   * MUST be pure — no network calls, no DI lookups, no filesystem. Anything
   * that requires I/O belongs in `bootstrap()`.
   *
   * Returning `undefined` is equivalent to an empty contribution set.
   */
  contribute(options: CloudOptions): CloudContributions | undefined;

  /**
   * Asynchronous bootstrap that runs AFTER the scope is initialized. The
   * cloud can fetch remote config, populate `runtime`, start background
   * workers, and register callbacks. Errors here log-and-continue — they
   * do not abort server startup.
   */
  bootstrap?(ctx: CloudBootstrapContext): Promise<void>;
}

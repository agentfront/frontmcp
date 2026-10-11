import type { ModelContext } from './webmcp.types';

/**
 * How the plugin tells a `ModelContext` built by `listWebMcpTools` / `registerWebMcpTools` that it started on
 * it and finished a sync. A registry symbol, so the copies of this module in each entry point agree on it.
 */
const SYNC_LISTENER = Symbol.for('@frontmcp/plugin-webmcp/sync-listener');

export interface WebMcpSyncListener {
  /** The plugin found this `ModelContext` and follows the server's tools on it. */
  started(): void;
  /** The plugin registered the server's current tools; `error` when listing them failed. */
  synced(error?: unknown): void;
}

type ListenedModelContext = ModelContext & { [SYNC_LISTENER]?: WebMcpSyncListener };

export function withSyncListener(modelContext: ModelContext, listener: WebMcpSyncListener): ModelContext {
  return Object.assign(modelContext, { [SYNC_LISTENER]: listener });
}

export function syncListenerOf(modelContext: ModelContext | undefined): WebMcpSyncListener | undefined {
  return (modelContext as ListenedModelContext | undefined)?.[SYNC_LISTENER];
}

/**
 * Offering a page's tools to agents before its server is loaded: `listWebMcpTools()` computes, at build time,
 * what WebMcpPlugin registers, and `registerWebMcpTools()` registers that list in the page and loads the server
 * on an agent's first call. The calls then run through the plugin. Neither imports the SDK.
 */

import { withSyncListener, type WebMcpSyncListener } from './webmcp.handoff';
import type {
  ModelContext,
  ModelContextRegisterToolOptions,
  ModelContextTool,
  ModelContextToolExecuteOptions,
} from './webmcp.types';

/** A tool as WebMcpPlugin passes it to `registerTool()`, without its `execute`. */
export type WebMcpToolDescriptor = Omit<ModelContextTool, 'execute'>;

/**
 * Builds the server, passing `modelContext` to `WebMcpPlugin.init({ modelContext })` with the plugin's other
 * options as the page uses them.
 */
export type WebMcpServerFactory<Server = unknown> = (modelContext: ModelContext) => Promise<Server>;

/** Options of `registerWebMcpTools()`. */
export interface RegisterWebMcpToolsOptions {
  /** Other origins the tools are offered to, as the plugin's `exposedTo` option. */
  exposedTo?: string[];
}

const NO_PLUGIN_MESSAGE =
  'The server has no WebMcpPlugin on the modelContext it was given: pass it to WebMcpPlugin.init({ modelContext })';

interface PluginSync {
  listener: WebMcpSyncListener;
  /** Resolves once the plugin registered the server's tools; rejects when no plugin started on the context. */
  whenSynced(): Promise<void>;
}

function createPluginSync(): PluginSync {
  let started = false;
  let resolveSynced: (() => void) | undefined;
  let rejectSynced: ((error: unknown) => void) | undefined;
  const synced = new Promise<void>((resolve, reject) => {
    resolveSynced = resolve;
    rejectSynced = reject;
  });
  // Marked handled now: the first sync may fail before anyone awaits it
  synced.catch(() => undefined);
  return {
    listener: {
      started: () => {
        started = true;
      },
      synced: (error) => (error === undefined ? resolveSynced?.() : rejectSynced?.(error)),
    },
    async whenSynced() {
      // The plugin starts once the server's scope is ready, which a macrotask later has happened
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!started) throw new Error(NO_PLUGIN_MESSAGE);
      await synced;
    },
  };
}

function fingerprintOf(descriptor: WebMcpToolDescriptor, exposedTo: string[] | undefined): string {
  return JSON.stringify([descriptor, exposedTo ?? []]);
}

/**
 * What WebMcpPlugin registers for the server `createServer` builds: names, titles, descriptions, input schemas
 * and hints, as JSON-safe values. Run it at build time and ship the result to `registerWebMcpTools()`. The
 * server is disposed before this resolves.
 *
 * @example
 * ```typescript
 * const tools = await listWebMcpTools((modelContext) => createShopServer({ modelContext }));
 * await writeFile('webmcp-tools.json', JSON.stringify(tools));
 * ```
 */
export async function listWebMcpTools(
  createServer: WebMcpServerFactory<{ dispose(): Promise<void> }>,
): Promise<WebMcpToolDescriptor[]> {
  const descriptors = new Map<string, WebMcpToolDescriptor>();
  const pluginSync = createPluginSync();
  const modelContext = withSyncListener(
    {
      async registerTool({ execute: _execute, ...descriptor }, options) {
        descriptors.set(descriptor.name, descriptor);
        options?.signal?.addEventListener('abort', () => descriptors.delete(descriptor.name), { once: true });
      },
    },
    pluginSync.listener,
  );
  const server = await createServer(modelContext);
  try {
    await pluginSync.whenSynced();
    return [...descriptors.values()];
  } finally {
    await server.dispose();
  }
}

/** One load of the server; a failed one no longer touches the page's registrations. */
interface LoadAttempt {
  failed: boolean;
}

/** A tool registered from the list, until the plugin adopts it or the server turns out not to have it. */
interface Placeholder {
  fingerprint: string;
  controller: AbortController;
  adopted: boolean;
}

class LazyWebMcpTools {
  private readonly placeholders = new Map<string, Placeholder>();
  /** The plugin's `execute` of every tool it registered, by name. */
  private readonly executors = new Map<string, ModelContextTool['execute']>();
  private loading?: Promise<void>;

  constructor(
    private readonly modelContext: ModelContext,
    private readonly loadServer: WebMcpServerFactory,
  ) {}

  async register(tools: readonly WebMcpToolDescriptor[], exposedTo: string[] | undefined): Promise<void> {
    await Promise.all(tools.map((tool) => this.registerPlaceholder(tool, exposedTo)));
  }

  private async registerPlaceholder(tool: WebMcpToolDescriptor, exposedTo: string[] | undefined): Promise<void> {
    const placeholder: Placeholder = {
      fingerprint: fingerprintOf(tool, exposedTo),
      controller: new AbortController(),
      adopted: false,
    };
    this.placeholders.set(tool.name, placeholder);
    try {
      await this.modelContext.registerTool(
        { ...tool, execute: (input, options) => this.call(tool.name, input, options) },
        { signal: placeholder.controller.signal, ...(exposedTo && { exposedTo }) },
      );
    } catch {
      // Refused (e.g. the name is taken): the plugin tries again, and reports it, once the server is loaded
      this.release(tool.name, placeholder);
    }
  }

  private async call(name: string, input: Record<string, unknown>, options: ModelContextToolExecuteOptions) {
    await this.load();
    const execute = this.executors.get(name);
    if (!execute) throw new Error(`Tool "${name}" not found`);
    return execute(input, options);
  }

  /** Load the server once; a failed load is tried again on the next call. */
  private load(): Promise<void> {
    this.loading ??= this.loadThroughPlugin().catch((error: unknown) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  private async loadThroughPlugin(): Promise<void> {
    const pluginSync = createPluginSync();
    const attempt: LoadAttempt = { failed: false };
    const handoff = withSyncListener(
      { registerTool: (tool, options) => this.adopt(tool, options, attempt) },
      pluginSync.listener,
    );
    const server = await this.loadServer(handoff);
    try {
      await pluginSync.whenSynced();
    } catch (error) {
      await this.abandon(attempt, server);
      throw error;
    }
    for (const [name, placeholder] of this.placeholders) {
      if (!placeholder.adopted) this.release(name, placeholder);
    }
  }

  /** Forget what a failed load's plugin registered, keep the listed tools for the next try, and dispose its server. */
  private async abandon(attempt: LoadAttempt, server: unknown): Promise<void> {
    attempt.failed = true;
    this.executors.clear();
    for (const placeholder of this.placeholders.values()) placeholder.adopted = false;
    const disposable = server as { dispose?: () => unknown } | undefined;
    if (typeof disposable?.dispose === 'function') await Promise.resolve(disposable.dispose()).catch(() => undefined);
  }

  /**
   * A registration from the plugin: an unchanged listed tool keeps its registration and runs the plugin's
   * `execute`; anything else replaces the listed tool of that name, or is new, and goes to the page's context.
   */
  private async adopt(
    tool: ModelContextTool,
    options: ModelContextRegisterToolOptions | undefined,
    attempt: LoadAttempt,
  ): Promise<void> {
    if (attempt.failed || options?.signal?.aborted) return;
    const { execute, ...descriptor } = tool;
    const placeholder = this.placeholders.get(tool.name);
    const kept =
      placeholder && !placeholder.adopted && placeholder.fingerprint === fingerprintOf(descriptor, options?.exposedTo)
        ? placeholder
        : undefined;
    this.executors.set(tool.name, execute);
    options?.signal?.addEventListener(
      'abort',
      () => {
        if (attempt.failed) return;
        if (this.executors.get(tool.name) === execute) this.executors.delete(tool.name);
        if (kept) this.release(tool.name, kept);
      },
      { once: true },
    );
    if (kept) {
      kept.adopted = true;
      return;
    }
    if (placeholder) this.release(tool.name, placeholder);
    await this.modelContext.registerTool(tool, options);
  }

  private release(name: string, placeholder: Placeholder): void {
    placeholder.controller.abort();
    if (this.placeholders.get(name) === placeholder) this.placeholders.delete(name);
  }
}

/**
 * Register `tools` (from `listWebMcpTools()`) with `modelContext` at once, without loading the server. An
 * agent's first call loads it with `loadServer` (once, however many calls arrive together) and runs through
 * WebMcpPlugin from then on, which also registers and unregisters tools as the server's tools change. Does
 * nothing when `modelContext` is undefined (no WebMCP in this browser).
 *
 * @example
 * ```typescript
 * import { registerWebMcpTools, resolveDocumentModelContext } from '@frontmcp/plugin-webmcp/register';
 * import tools from './webmcp-tools.json';
 *
 * void registerWebMcpTools(resolveDocumentModelContext(), tools, (modelContext) =>
 *   import('./server').then(({ createShopServer }) => createShopServer({ modelContext })),
 * );
 * ```
 */
export async function registerWebMcpTools(
  modelContext: ModelContext | undefined,
  tools: readonly WebMcpToolDescriptor[],
  loadServer: WebMcpServerFactory,
  options: RegisterWebMcpToolsOptions = {},
): Promise<void> {
  if (!modelContext) return;
  await new LazyWebMcpTools(modelContext, loadServer).register(tools, options.exposedTo);
}

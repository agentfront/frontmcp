/**
 * WebMcpBridge - exposes a FrontMCP server's tools to in-browser agents through WebMCP.
 *
 * It is a transport adapter: it only translates. The tool list comes from the `tools:list-tools`
 * flow and every call runs the `tools:call-tool` flow, both on the `'webmcp'` surface, so
 * `availableWhen`, authorities, hooks and quota apply to an agent's calls as to any other client's.
 */

import { FlowControl, type CallToolResult, type FrontMcpLogger, type ScopeEntry } from '@frontmcp/sdk';
import { randomUUID, runRequestExclusive } from '@frontmcp/utils';

import type { WebMcpListedTool, WebMcpPluginOptions } from './webmcp.options';
import type {
  ModelContext,
  ModelContextTool,
  ModelContextToolAnnotations,
  ModelContextToolExecuteOptions,
} from './webmcp.types';

/** WebMCP tool names: 1-128 characters from `[A-Za-z0-9_.-]`. */
const MAX_WEBMCP_NAME_LENGTH = 128;
const INVALID_NAME_CHARACTERS = /[^A-Za-z0-9_.-]/g;

/** What a WebMCP call resolves to: the MCP result without its `_meta` (and never `isError`). */
export interface WebMcpToolResult {
  content: CallToolResult['content'];
  structuredContent?: CallToolResult['structuredContent'];
}

/** The auth info the flows read from a call's context. */
interface WebMcpAuthInfo {
  sessionId: string;
  user: { iss: string; sub: string; [key: string]: unknown };
  scopes: string[];
  clientId: string;
  token?: string;
  extra?: Record<string, unknown>;
}

/** A tool registered with the ModelContext, and how to take it back. */
interface Registration {
  mcpName: string;
  fingerprint: string;
  controller: AbortController;
}

/** A tool as it should be registered, before it has an `execute`. */
interface DesiredTool {
  mcpName: string;
  descriptor: Omit<ModelContextTool, 'execute'>;
  fingerprint: string;
}

/** `document.modelContext` in a browser that implements WebMCP (or has a polyfill installed). */
export function resolveDocumentModelContext(): ModelContext | undefined {
  const modelContext = (globalThis as { document?: { modelContext?: unknown } }).document?.modelContext;
  return typeof modelContext === 'object' &&
    modelContext !== null &&
    typeof (modelContext as ModelContext).registerTool === 'function'
    ? (modelContext as ModelContext)
    : undefined;
}

/** Whether this page can register WebMCP tools (`document.modelContext.registerTool` exists). */
export function isWebMcpSupported(): boolean {
  return resolveDocumentModelContext() !== undefined;
}

/** Make `name` a valid WebMCP tool name: invalid characters become `_`, cut to 128 characters. */
export function toWebMcpToolName(name: string): string {
  const cleaned = name.replace(INVALID_NAME_CHARACTERS, '_').slice(0, MAX_WEBMCP_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : '_';
}

/** `base`, or `base_2`, `base_3`, ... (still within 128 characters), whichever `taken` lacks. */
function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `_${n}`;
    const candidate = base.slice(0, MAX_WEBMCP_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * MCP annotations as WebMCP hints. Only what an MCP tool states explicitly carries over: a tool that
 * says nothing about being destructive is not flagged consequential.
 */
function toWebMcpAnnotations(annotations: WebMcpListedTool['annotations']): ModelContextToolAnnotations | undefined {
  const hints: ModelContextToolAnnotations = {};
  if (annotations?.readOnlyHint === true) hints.readOnlyHint = true;
  if (annotations?.destructiveHint === true) hints.consequentialHint = true;
  if (annotations?.openWorldHint === true) hints.untrustedContentHint = true;
  return Object.keys(hints).length > 0 ? hints : undefined;
}

function textOf(content: CallToolResult['content'] | undefined): string {
  return (content ?? [])
    .map((block) => (block.type === 'text' ? block.text : ''))
    .filter((text) => text.length > 0)
    .join('\n');
}

/** The error an agent sees: what an MCP client would see (public message), never internals. */
function toAgentError(error: unknown): Error {
  const publicMessage = (error as { getPublicMessage?: () => string } | null)?.getPublicMessage;
  if (typeof publicMessage === 'function') return new Error(publicMessage.call(error));
  return error instanceof Error ? error : new Error(String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class WebMcpBridge {
  private readonly logger: FrontMcpLogger;
  private readonly sessionId = `webmcp:${randomUUID()}`;
  private readonly registrations = new Map<string, Registration>();
  /** Registrations the ModelContext refused, by name, so the same refusal is reported once. */
  private readonly refused = new Map<string, string>();
  private modelContext?: ModelContext;
  private unsubscribe?: () => void;
  private started = false;
  private stopped = false;
  /** A registry change arrived that no sync has picked up yet. */
  private pending = false;
  /** The scheduled or running sync loop. */
  private run?: Promise<void>;

  constructor(
    private readonly scope: ScopeEntry,
    private readonly options: WebMcpPluginOptions,
  ) {
    this.logger = scope.logger.child('webmcp');
  }

  /** WebMCP names of the tools currently registered with the ModelContext. */
  get registeredToolNames(): string[] {
    return [...this.registrations.keys()];
  }

  /**
   * Find the ModelContext and keep it in sync with the server's tools. Without one (Node, a browser
   * without WebMCP and no polyfill) the bridge does nothing.
   */
  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;

    const modelContext = this.options.modelContext ?? resolveDocumentModelContext();
    if (!modelContext) {
      this.logger.debug('WebMCP is not available here (no document.modelContext); tools are not exposed');
      return;
    }
    this.modelContext = modelContext;
    this.unsubscribe = this.scope.tools.subscribe({ immediate: true }, () => this.refresh());
  }

  /**
   * Re-list the server's tools and update the registrations. The bridge does this on every tool
   * registry change; call it when something else changes what the caller may see, such as the
   * `authContext` a function option returns.
   */
  refresh(): void {
    if (!this.modelContext || this.stopped) return;
    this.pending = true;
    this.run ??= this.drain();
  }

  /** Resolves once no sync is scheduled or running. */
  async whenIdle(): Promise<void> {
    while (this.run) await this.run;
  }

  /** Unregister every tool and stop following the registry. Calling it again does nothing. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const registration of this.registrations.values()) registration.controller.abort();
    this.registrations.clear();
  }

  /** Sync until no change is pending. Starts a microtask later, so a burst of changes syncs once. */
  private async drain(): Promise<void> {
    await Promise.resolve();
    try {
      while (this.pending && !this.stopped) {
        this.pending = false;
        try {
          await this.sync();
        } catch (error) {
          this.logger.warn(`WebMCP sync failed: ${toAgentError(error).message}`);
        }
      }
    } finally {
      this.run = undefined;
    }
  }

  private async sync(): Promise<void> {
    const desired = this.desiredTools(await this.listTools());
    if (this.stopped) return;

    for (const [name, registration] of this.registrations) {
      if (desired.get(name)?.fingerprint === registration.fingerprint) continue;
      registration.controller.abort();
      this.registrations.delete(name);
    }

    for (const [name, tool] of desired) {
      if (this.registrations.has(name) || this.stopped) continue;
      await this.register(name, tool);
    }
  }

  /** The server's tools as the `'webmcp'` surface sees them, every page of them. */
  private async listTools(): Promise<WebMcpListedTool[]> {
    const tools: WebMcpListedTool[] = [];
    const authInfo = await this.authInfo();
    let cursor: string | undefined;
    do {
      const request = { method: 'tools/list' as const, params: cursor === undefined ? {} : { cursor } };
      const page = await this.exclusive(() =>
        this.scope.runFlowForOutput('tools:list-tools', { request, ctx: { authInfo, surface: 'webmcp' } }),
      );
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  private desiredTools(listed: WebMcpListedTool[]): Map<string, DesiredTool> {
    const desired = new Map<string, DesiredTool>();
    for (const tool of listed) {
      if (this.options.include && !this.options.include(tool)) continue;
      const name = uniqueName(toWebMcpToolName(this.options.prefix + tool.name), new Set(desired.keys()));
      const title = tool.title ?? tool.annotations?.title;
      const annotations = toWebMcpAnnotations(tool.annotations);
      const descriptor: DesiredTool['descriptor'] = {
        name,
        ...(title && { title }),
        description: tool.description || title || tool.name,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        ...(annotations && { annotations }),
      };
      desired.set(name, { mcpName: tool.name, descriptor, fingerprint: JSON.stringify([tool.name, descriptor]) });
    }
    return desired;
  }

  private async register(name: string, tool: DesiredTool): Promise<void> {
    const modelContext = this.modelContext as ModelContext;
    const controller = new AbortController();
    // Recorded first, so a stop() while the ModelContext answers still aborts it
    this.registrations.set(name, { mcpName: tool.mcpName, fingerprint: tool.fingerprint, controller });
    try {
      await modelContext.registerTool(
        { ...tool.descriptor, execute: (input, options) => this.execute(tool.mcpName, input, options) },
        { signal: controller.signal, ...(this.options.exposedTo && { exposedTo: this.options.exposedTo }) },
      );
      this.refused.delete(name);
    } catch (error) {
      if (this.registrations.get(name)?.controller === controller) this.registrations.delete(name);
      controller.abort();
      const message = `WebMCP refused tool "${name}": ${toAgentError(error).message}`;
      if (this.refused.get(name) === tool.fingerprint) {
        this.logger.debug(message);
      } else {
        this.refused.set(name, tool.fingerprint);
        this.logger.warn(message);
      }
    }
  }

  /** Run one agent call through the `tools:call-tool` flow, and translate its result for WebMCP. */
  private async execute(
    mcpName: string,
    input: unknown,
    options?: Partial<ModelContextToolExecuteOptions>,
  ): Promise<WebMcpToolResult> {
    let result: CallToolResult;
    try {
      const request = {
        method: 'tools/call' as const,
        params: { name: mcpName, arguments: isRecord(input) ? input : {} },
      };
      const ctx = {
        authInfo: await this.authInfo(),
        surface: 'webmcp',
        ...(options?.signal && { signal: options.signal }),
      };
      result = await this.exclusive(() => this.scope.runFlowForOutput('tools:call-tool', { request, ctx }));
    } catch (error) {
      throw toAgentError(error);
    }
    if (result.isError) throw new Error(textOf(result.content) || `Tool "${mcpName}" failed`);
    return {
      content: result.content ?? [],
      ...(result.structuredContent !== undefined && { structuredContent: result.structuredContent }),
    };
  }

  /**
   * Run a flow as its own request. A browser build without AsyncContext runs requests one at a
   * time; this takes the turn. A flow that answers by `respond` is output, not a failure.
   */
  private async exclusive<Output>(runFlow: () => Promise<Output>): Promise<Output> {
    try {
      return await runRequestExclusive(runFlow);
    } catch (error) {
      if (error instanceof FlowControl && error.type === 'respond') return error.output as Output;
      throw error;
    }
  }

  /** The caller the flows see: the `authContext` option, or an anonymous `webmcp` caller. */
  private async authInfo(): Promise<WebMcpAuthInfo> {
    const option = this.options.authContext;
    const authContext = typeof option === 'function' ? await option() : option;
    const user = authContext?.user;
    const sub = typeof user?.sub === 'string' ? user.sub : 'webmcp';
    const iss = typeof user?.['iss'] === 'string' ? (user['iss'] as string) : 'webmcp';
    return {
      sessionId: authContext?.sessionId ?? this.sessionId,
      user: { ...user, iss, sub },
      scopes: [],
      clientId: sub,
      ...(authContext?.token !== undefined && { token: authContext.token }),
      ...(authContext?.extra && { extra: authContext.extra }),
    };
  }
}

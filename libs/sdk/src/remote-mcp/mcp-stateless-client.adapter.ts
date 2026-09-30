/**
 * Adapter presenting an {@link McpStatelessClient} through the subset of the upstream
 * `Client` API that {@link McpClientService} uses.
 *
 * The remote-proxy is built around `@modelcontextprotocol/sdk`'s `Client`, which
 * cannot speak 2026-07-28 — it opens with `initialize` and assumes a session.
 * Rather than fork the proxy, this adapter satisfies the nine methods the
 * service actually calls, so a remote server on either revision looks the same
 * to everything downstream.
 *
 * @module remote-mcp/mcp-stateless-client.adapter
 */
import { type ServerCapabilities } from '@frontmcp/protocol';

import { McpStatelessClient, type McpStatelessClientOptions } from '../transport/mcp-20260728';

/** One page of a list request, as `McpClientService` pages through it. */
interface ListPageParams {
  cursor?: string;
}

/** The `Client` surface `McpClientService` depends on. */
export interface RemoteClientLike {
  listTools(params?: ListPageParams): Promise<{ tools: unknown[]; nextCursor?: string }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  listResources(params?: ListPageParams): Promise<{ resources: unknown[]; nextCursor?: string }>;
  readResource(params: { uri: string }): Promise<unknown>;
  listResourceTemplates(params?: ListPageParams): Promise<{ resourceTemplates: unknown[]; nextCursor?: string }>;
  listPrompts(params?: ListPageParams): Promise<{ prompts: unknown[]; nextCursor?: string }>;
  getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<unknown>;
  getServerCapabilities(): ServerCapabilities | undefined;
  close(): Promise<void>;
}

/** `{ nextCursor }` when a list result carries one, else nothing. */
function nextCursorOf(result: Record<string, unknown>): { nextCursor?: string } {
  const next = result['nextCursor'];
  return typeof next === 'string' && next.length > 0 ? { nextCursor: next } : {};
}

export class McpStatelessClientAdapter implements RemoteClientLike {
  private readonly client: McpStatelessClient;
  private capabilities: ServerCapabilities | undefined;

  constructor(options: McpStatelessClientOptions) {
    this.client = new McpStatelessClient(options);
  }

  /**
   * Probe the remote with `server/discover` and cache its capabilities.
   *
   * Replaces `initialize` as the connect step: it is the only round trip this
   * revision defines for learning what a server offers.
   */
  async connect(): Promise<void> {
    const result = await this.client.discover();
    this.capabilities = result['capabilities'] as ServerCapabilities | undefined;
  }

  getServerCapabilities(): ServerCapabilities | undefined {
    return this.capabilities;
  }

  async listTools(): Promise<{ tools: unknown[]; nextCursor?: string }> {
    // Goes through the client's own listTools so tools with invalid
    // `x-mcp-header` annotations are dropped and the schemas are cached for
    // header mirroring on subsequent calls. It already follows every page, so
    // there is no cursor to hand back.
    return { tools: await this.client.listTools() };
  }

  async callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
    return this.client.callTool(params.name, params.arguments ?? {});
  }

  async listResources(params?: ListPageParams): Promise<{ resources: unknown[]; nextCursor?: string }> {
    const result = await this.client.listResources(params?.cursor);
    return {
      resources: Array.isArray(result['resources']) ? (result['resources'] as unknown[]) : [],
      ...nextCursorOf(result),
    };
  }

  async listResourceTemplates(params?: ListPageParams): Promise<{ resourceTemplates: unknown[]; nextCursor?: string }> {
    const result = await this.client.listResourceTemplates(params?.cursor);
    return {
      resourceTemplates: Array.isArray(result['resourceTemplates']) ? (result['resourceTemplates'] as unknown[]) : [],
      ...nextCursorOf(result),
    };
  }

  async readResource(params: { uri: string }): Promise<unknown> {
    return this.client.readResource(params.uri);
  }

  async listPrompts(params?: ListPageParams): Promise<{ prompts: unknown[]; nextCursor?: string }> {
    const result = await this.client.listPrompts(params?.cursor);
    return {
      prompts: Array.isArray(result['prompts']) ? (result['prompts'] as unknown[]) : [],
      ...nextCursorOf(result),
    };
  }

  async getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<unknown> {
    return this.client.getPrompt(params.name, params.arguments ?? {});
  }

  async close(): Promise<void> {
    // Nothing to tear down: 2026-07-28 holds no connection state between
    // requests, which is the whole point of removing sessions.
  }
}

/**
 * Decide which revision to speak to a remote server.
 *
 * `'auto'` runs the spec's own backward-compatibility probe: ask for
 * `server/discover` first. ANY failure — a transport error, a timeout, a
 * non-2026 server, or a response that does not advertise `2026-07-28` — selects
 * the legacy path. Anything other than `'auto'` is an explicit choice by the
 * operator, and the default stays on the legacy path so existing deployments are
 * untouched.
 */
export async function negotiateRemoteProtocol(
  url: string,
  configured: string | undefined,
  headers: Record<string, string> | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<'2026-07-28' | 'legacy'> {
  if (configured === '2026-07-28') return '2026-07-28';
  if (configured !== 'auto') return 'legacy';

  try {
    const probe = new McpStatelessClient({ url, headers, fetchImpl });
    const result = await probe.discover();
    const supported = result['supportedVersions'];
    return Array.isArray(supported) && supported.includes('2026-07-28') ? '2026-07-28' : 'legacy';
  } catch {
    // A server that cannot answer `server/discover` is pre-2026 by definition.
    return 'legacy';
  }
}

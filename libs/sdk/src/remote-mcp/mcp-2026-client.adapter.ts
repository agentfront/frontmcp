/**
 * Adapter presenting an {@link Mcp2026Client} through the subset of the upstream
 * `Client` API that {@link McpClientService} uses.
 *
 * The remote-proxy is built around `@modelcontextprotocol/sdk`'s `Client`, which
 * cannot speak 2026-07-28 — it opens with `initialize` and assumes a session.
 * Rather than fork the proxy, this adapter satisfies the eight methods the
 * service actually calls, so a remote server on either revision looks the same
 * to everything downstream.
 *
 * @module remote-mcp/mcp-2026-client.adapter
 */
import { type ServerCapabilities } from '@frontmcp/protocol';

import { Mcp2026Client, type Mcp2026ClientOptions } from '../transport/mcp-2026';

/** The `Client` surface `McpClientService` depends on. */
export interface RemoteClientLike {
  listTools(): Promise<{ tools: unknown[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  listResources(): Promise<{ resources: unknown[] }>;
  readResource(params: { uri: string }): Promise<unknown>;
  listPrompts(): Promise<{ prompts: unknown[] }>;
  getPrompt(params: { name: string; arguments?: Record<string, string> }): Promise<unknown>;
  getServerCapabilities(): ServerCapabilities | undefined;
  close(): Promise<void>;
}

export class Mcp2026ClientAdapter implements RemoteClientLike {
  private readonly client: Mcp2026Client;
  private capabilities: ServerCapabilities | undefined;

  constructor(options: Mcp2026ClientOptions) {
    this.client = new Mcp2026Client(options);
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

  async listTools(): Promise<{ tools: unknown[] }> {
    // Goes through the client's own listTools so tools with invalid
    // `x-mcp-header` annotations are dropped and the schemas are cached for
    // header mirroring on subsequent calls.
    return { tools: await this.client.listTools() };
  }

  async callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<unknown> {
    return this.client.callTool(params.name, params.arguments ?? {});
  }

  async listResources(): Promise<{ resources: unknown[] }> {
    const result = await this.client.listResources();
    return { resources: Array.isArray(result['resources']) ? (result['resources'] as unknown[]) : [] };
  }

  async readResource(params: { uri: string }): Promise<unknown> {
    return this.client.readResource(params.uri);
  }

  async listPrompts(): Promise<{ prompts: unknown[] }> {
    const result = await this.client.listPrompts();
    return { prompts: Array.isArray(result['prompts']) ? (result['prompts'] as unknown[]) : [] };
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
    const probe = new Mcp2026Client({ url, headers, fetchImpl });
    const result = await probe.discover();
    const supported = result['supportedVersions'];
    return Array.isArray(supported) && supported.includes('2026-07-28') ? '2026-07-28' : 'legacy';
  } catch {
    // A server that cannot answer `server/discover` is pre-2026 by definition.
    return 'legacy';
  }
}

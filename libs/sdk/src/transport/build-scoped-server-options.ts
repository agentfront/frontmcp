/**
 * Builds the MCP `ServerOptions` (capabilities + serverInfo) for a Scope.
 *
 * Extracted from `createInMemoryServer` so every transport that stands up an
 * `McpServer` for a Scope — in-memory, and the Web-fetch handler used by the
 * Cloudflare Worker target — advertises the SAME capability set. Capability
 * drift between transports is a real bug class (a client over HTTP sees an
 * extension the same Scope hides over the Worker), so this is the single
 * source of truth.
 */
import { type ServerCapabilities } from '@frontmcp/protocol';

import { type Scope } from '../scope/scope.instance';
import { computeTaskCapabilities } from '../task';

/**
 * The MCP `ServerOptions.capabilities` type doesn't model the forward-compat
 * `extensions` key (reserved for SEP-2133), so we widen it locally rather than
 * casting through `Record<string, never>`. Runtime passthrough is unchanged.
 */
export type ServerCapabilitiesWithExtensions = ServerCapabilities & {
  extensions?: Record<string, unknown>;
};

export interface ScopedServerOptions {
  instructions: string;
  capabilities: ServerCapabilitiesWithExtensions;
  serverInfo: Scope['metadata']['info'];
}

/**
 * Compute the MCP server capabilities + serverInfo for a Scope.
 *
 * SEP-2640 / SEP-2133 capabilities live inside `experimental` / `extensions`,
 * so we lift those keys out of EVERY fragment (not just `scope.skills`) and
 * merge them — otherwise a client would miss extension capabilities that
 * another transport advertises against the same Scope.
 */
export function buildScopedServerOptions(scope: Scope, instructions = ''): ScopedServerOptions {
  const hasRemoteApps = scope.apps?.getApps().some((app) => app.isRemote) ?? false;

  const hasPrompts = scope.prompts.hasAny() || hasRemoteApps;
  const hasResources = scope.resources.hasAny() || hasRemoteApps;

  const completionsCapability = hasPrompts || hasResources ? { completions: {} } : {};
  const remoteCapabilities = hasRemoteApps
    ? {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
      }
    : {};

  const skillsCapabilities = scope.skills?.getCapabilities() ?? {};
  const toolsCapabilities = scope.tools.getCapabilities();
  const resourcesCapabilities = scope.resources.getCapabilities();
  const promptsCapabilities = scope.prompts.getCapabilities();
  const agentsCapabilities = scope.agents.getCapabilities();
  const taskCapabilities = computeTaskCapabilities(scope);

  const fragments: Array<Record<string, unknown>> = [
    remoteCapabilities,
    toolsCapabilities,
    resourcesCapabilities,
    promptsCapabilities,
    agentsCapabilities,
    skillsCapabilities,
    completionsCapability,
    taskCapabilities,
  ];

  const experimental: Record<string, unknown> = {};
  const extensions: Record<string, unknown> = {};
  for (const cap of fragments) {
    if (cap['experimental'] && typeof cap['experimental'] === 'object') {
      Object.assign(experimental, cap['experimental']);
    }
    if (cap['extensions'] && typeof cap['extensions'] === 'object') {
      Object.assign(extensions, cap['extensions']);
    }
  }

  const baseCapabilities: Record<string, unknown> = {
    ...remoteCapabilities,
    ...toolsCapabilities,
    ...resourcesCapabilities,
    ...promptsCapabilities,
    ...agentsCapabilities,
    ...completionsCapability,
    ...taskCapabilities,
    logging: {},
  };
  if (Object.keys(experimental).length > 0) baseCapabilities['experimental'] = experimental;
  if (Object.keys(extensions).length > 0) baseCapabilities['extensions'] = extensions;

  return {
    instructions,
    capabilities: baseCapabilities as unknown as ServerCapabilitiesWithExtensions,
    serverInfo: scope.metadata.info,
  };
}

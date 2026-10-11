/**
 * MCP-client snippet emitters (issue #400).
 *
 * Each function takes the resolved config and returns the JSON the user
 * pastes into their client's config file. Format choices match the
 * existing copy-paste snippets in
 * `libs/skills/catalog/frontmcp-deployment/examples/mcp-client-integration/`:
 *
 *   claude-code      → `~/.config/claude/mcp.json` (or `claude_desktop_config.json`)
 *                       structure: `{ "mcpServers": { "<name>": { ... } } }`
 *   claude-desktop   → same structure as claude-code; commonly stored at
 *                       `~/Library/Application Support/Claude/claude_desktop_config.json`
 *   cursor / vscode  → same structure (`{ "mcpServers": { ... } }`)
 *   windsurf         → `~/.codeium/windsurf/mcp_config.json`, same shape
 *
 * All four shapes are byte-compatible — the differences are file location +
 * surrounding wrapper, both of which the user handles after pasting.
 */

import { envOverlayFor, type FrontMcpConfigParsed, type McpClientName } from '../../config';

export interface ClientPayloadOptions {
  /** The project's npm package name (`package.json` `name`), started by the default stdio entry. */
  packageName?: string;
}

interface ServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'http' | 'sse' | 'stdio';
}

function buildServerEntry(
  client: McpClientName,
  config: FrontMcpConfigParsed,
  options: ClientPayloadOptions,
): ServerEntry {
  const connection = config.clients?.[client];
  if (!connection) {
    throw new Error(
      `frontmcp.config has no \`clients.${client}\` entry. ` +
        `Add it: \`clients: { '${client}': { transport: '...' , ... } }\``,
    );
  }

  // Stdio: spawn `command` with `args` + `env`. Most MCP clients omit the
  // `transport` field when stdio (it's the default), so we follow suit.
  // The default runs the published package's bin with `--stdio`.
  if (connection.transport === 'stdio') {
    const command = connection.command ?? 'npx';
    const args = connection.args ?? ['-y', options.packageName ?? config.name, '--stdio'];
    const entry: ServerEntry = { command, args };
    // The client spawns the shipped server: `env.shared` ⊕ `env.ship`, then the client's own `env` (#680)
    const env = { ...envOverlayFor(config, 'build:ship'), ...connection.env };
    if (Object.keys(env).length > 0) entry.env = env;
    return entry;
  }

  // HTTP / SSE: emit `url` + `transport`. URL falls back to the configured
  // HTTP port when none is provided. We collect every deployment port and
  // only derive a fallback when exactly one is available — picking the
  // first of several would point the user's client at an arbitrary server.
  const deploymentPorts = config.deployments
    .map((d) => ('server' in d ? d.server?.http?.port : undefined))
    .filter((p): p is number => typeof p === 'number');
  const derivedDeploymentPort = deploymentPorts.length === 1 ? deploymentPorts[0] : undefined;
  const httpPort = config.transport?.http?.port ?? derivedDeploymentPort;
  const httpHost = config.transport?.http?.host ?? '127.0.0.1';
  const httpPath = config.transport?.http?.path ?? '/mcp';
  const fallbackUrl = httpPort ? `http://${httpHost}:${httpPort}${httpPath}` : undefined;
  const url = connection.url ?? fallbackUrl;
  if (!url) {
    if (!connection.url && deploymentPorts.length > 1) {
      throw new Error(
        `frontmcp.config \`clients.${client}.url\` is required when multiple deployment HTTP ports are configured.`,
      );
    }
    throw new Error(
      `frontmcp.config \`clients.${client}\` needs a \`url\`, or a \`transport.http.port\` / deployment HTTP port to derive one.`,
    );
  }
  const entry: ServerEntry = { url, transport: connection.transport };
  if (connection.env && Object.keys(connection.env).length > 0) entry.env = { ...connection.env };
  return entry;
}

/**
 * Build the user-pasteable snippet for the given client. All five clients
 * use the `{ mcpServers: { <name>: { ... } } }` shape — they differ only in
 * the file the user pastes it into.
 */
export function buildClientPayload(
  client: McpClientName,
  config: FrontMcpConfigParsed,
  options: ClientPayloadOptions = {},
): { mcpServers: Record<string, ServerEntry> } {
  const connection = config.clients?.[client];
  const serverKey = connection?.name ?? config.name;
  return { mcpServers: { [serverKey]: buildServerEntry(client, config, options) } };
}

export function emitClientSnippet(
  client: McpClientName,
  config: FrontMcpConfigParsed,
  options: ClientPayloadOptions = {},
): string {
  return JSON.stringify(buildClientPayload(client, config, options), null, 2);
}

/**
 * Merge the payload into the client config text in `existing` (the target file's
 * current contents, or `undefined` when it does not exist). Other top-level keys
 * and other `mcpServers` entries are preserved; only this server's entry is replaced.
 */
export function mergeClientConfig(
  existing: string | undefined,
  payload: { mcpServers: Record<string, ServerEntry> },
): string {
  let current: Record<string, unknown> = {};
  if (existing !== undefined && existing.trim() !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(existing);
    } catch (err) {
      throw new Error(`Existing client config is not valid JSON, refusing to overwrite it: ${(err as Error).message}`, {
        cause: err,
      });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Existing client config is not a JSON object, refusing to overwrite it.');
    }
    current = parsed as Record<string, unknown>;
  }
  const currentServers =
    current['mcpServers'] && typeof current['mcpServers'] === 'object' && !Array.isArray(current['mcpServers'])
      ? (current['mcpServers'] as Record<string, unknown>)
      : {};
  return JSON.stringify({ ...current, mcpServers: { ...currentServers, ...payload.mcpServers } }, null, 2);
}

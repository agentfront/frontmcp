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

import type { FrontMcpConfigParsed, McpClientName } from '../../config';

interface ServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: 'http' | 'sse' | 'stdio';
}

function buildServerEntry(client: McpClientName, config: FrontMcpConfigParsed): ServerEntry {
  const connection = config.clients?.[client];
  if (!connection) {
    throw new Error(
      `frontmcp.config has no \`clients.${client}\` entry. ` +
        `Add it: \`clients: { '${client}': { transport: '...' , ... } }\``,
    );
  }

  // Stdio: spawn `command` with `args` + `env`. Most MCP clients omit the
  // `transport` field when stdio (it's the default), so we follow suit.
  if (connection.transport === 'stdio') {
    const command = connection.command ?? 'npx';
    const args = connection.args ?? ['-y', config.name];
    const entry: ServerEntry = { command, args };
    if (connection.env && Object.keys(connection.env).length > 0) entry.env = { ...connection.env };
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
export function emitClientSnippet(client: McpClientName, config: FrontMcpConfigParsed): string {
  const connection = config.clients?.[client];
  const serverKey = connection?.name ?? config.name;
  const entry = buildServerEntry(client, config);
  const payload = { mcpServers: { [serverKey]: entry } };
  return JSON.stringify(payload, null, 2);
}

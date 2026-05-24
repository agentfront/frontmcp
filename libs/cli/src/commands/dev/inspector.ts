import { runCmd } from '@frontmcp/utils';

import { resolveConfig, type FrontMcpConfigParsed } from '../../config';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';

/**
 * Build the argv passed to `npx` to launch the modern MCP Inspector
 * (`@modelcontextprotocol/inspector`).
 *
 * The Inspector UI mode CLI surface (verified against
 * github.com/modelcontextprotocol/inspector/blob/main/cli/src/cli.ts) is:
 *
 *   inspector [-e KEY=VALUE]... [--transport stdio|sse|http]
 *             [--server-url <url>] [--header "H: V"] [--] <command> [args...]
 *
 *   - `--transport http` is shorthand and is remapped to `streamable-http`
 *     internally.
 *   - For stdio, the server is supplied as **positional** `<command> [args...]`
 *     after `--` (separator so leading-dash args aren't parsed as Inspector
 *     flags). There is no `--server-command` / `--server-args` pair — those
 *     are URL query params for the browser UI, not CLI flags.
 *
 * Exported for unit-testing without spawning npx.
 */
export function buildInspectorArgs(config: FrontMcpConfigParsed | undefined): string[] {
  const args: string[] = ['-y', '@modelcontextprotocol/inspector'];
  const transport = config?.transport;
  if (transport?.default === 'http' && transport.http?.port) {
    const host = transport.http.host ?? '127.0.0.1';
    const mountPath = transport.http.path ?? '/mcp';
    args.push('--transport', 'http', '--server-url', `http://${host}:${transport.http.port}${mountPath}`);
  } else if (transport?.default === 'sse' && transport.http?.port) {
    const host = transport.http.host ?? '127.0.0.1';
    args.push('--transport', 'sse', '--server-url', `http://${host}:${transport.http.port}/sse`);
  } else if (transport?.default === 'stdio' && transport.stdio?.command) {
    args.push('--transport', 'stdio', '--', transport.stdio.command, ...(transport.stdio.args ?? []));
  }
  return args;
}

/**
 * Launch MCP Inspector against the configured transport (issue #400).
 *
 * Reads `transport.default` and `transport.http.port` from the resolved
 * `frontmcp.config` to build the inspector args automatically. When the
 * config selects HTTP, the inspector is pointed at the configured URL so
 * users don't have to type it. When no config is found we fall back to the
 * stock launch (inspector with no transport target — interactive picker).
 */
export async function runInspector(opts: ParsedArgs = { _: [] } as unknown as ParsedArgs): Promise<void> {
  const resolved = await resolveConfig({
    cwd: process.cwd(),
    mode: 'inspector',
    configPath: typeof opts.config === 'string' ? opts.config : undefined,
  });

  const args = buildInspectorArgs(resolved.config);

  console.log(`${c('cyan', '[inspector]')} launching MCP Inspector...`);
  if (resolved.configPath || resolved.configDir) {
    console.log(`${c('gray', '[inspector]')} config: ${resolved.configPath ?? resolved.configDir}`);
  }
  await runCmd('npx', args);
}

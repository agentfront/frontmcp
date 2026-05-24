/**
 * Inspector args builder tests (issue #400).
 *
 * Pins the argv we send to `npx -y @modelcontextprotocol/inspector` against
 * the modern Inspector CLI surface (verified against
 * github.com/modelcontextprotocol/inspector/blob/main/cli/src/cli.ts). The
 * Inspector does NOT accept `--server-command` / `--server-args` — earlier
 * versions of this file did, which produced a silent no-op launch.
 *
 *   - HTTP / SSE: `--transport <type> --server-url <url>`
 *   - STDIO:      `--transport stdio -- <command> [args...]` (positional)
 *   - No config:  bare `npx -y @modelcontextprotocol/inspector`
 *                 (Inspector falls back to its interactive picker)
 */

import type { FrontMcpConfigParsed } from '../../../config';
import { buildInspectorArgs } from '../inspector';

function baseConfig(overrides: Partial<FrontMcpConfigParsed> = {}): FrontMcpConfigParsed {
  return {
    name: 'demo',
    deployments: [{ target: 'node' }],
    ...overrides,
  } as FrontMcpConfigParsed;
}

describe('buildInspectorArgs (issue #400)', () => {
  it('emits the bare launcher when no config is resolved', () => {
    expect(buildInspectorArgs(undefined)).toEqual(['-y', '@modelcontextprotocol/inspector']);
  });

  it('emits the bare launcher when the config has no transport section', () => {
    expect(buildInspectorArgs(baseConfig())).toEqual(['-y', '@modelcontextprotocol/inspector']);
  });

  describe('http transport', () => {
    it('builds --transport http --server-url <url> from transport.http', () => {
      const config = baseConfig({
        transport: { default: 'http', http: { port: 4321 } },
      } as Partial<FrontMcpConfigParsed>);
      expect(buildInspectorArgs(config)).toEqual([
        '-y',
        '@modelcontextprotocol/inspector',
        '--transport',
        'http',
        '--server-url',
        'http://127.0.0.1:4321/mcp',
      ]);
    });

    it('honors a custom host and path', () => {
      const config = baseConfig({
        transport: { default: 'http', http: { port: 9000, host: '0.0.0.0', path: '/api/mcp' } },
      } as Partial<FrontMcpConfigParsed>);
      const args = buildInspectorArgs(config);
      expect(args).toContain('--server-url');
      expect(args[args.indexOf('--server-url') + 1]).toBe('http://0.0.0.0:9000/api/mcp');
    });

    it('falls back to the bare launcher when http port is missing', () => {
      const config = baseConfig({ transport: { default: 'http' } } as Partial<FrontMcpConfigParsed>);
      expect(buildInspectorArgs(config)).toEqual(['-y', '@modelcontextprotocol/inspector']);
    });
  });

  describe('sse transport', () => {
    it('builds --transport sse --server-url <url>/sse from transport.http port', () => {
      const config = baseConfig({
        transport: { default: 'sse', http: { port: 4321 } },
      } as Partial<FrontMcpConfigParsed>);
      expect(buildInspectorArgs(config)).toEqual([
        '-y',
        '@modelcontextprotocol/inspector',
        '--transport',
        'sse',
        '--server-url',
        'http://127.0.0.1:4321/sse',
      ]);
    });
  });

  describe('stdio transport', () => {
    it('passes the server command + args as positional after --', () => {
      const config = baseConfig({
        transport: { default: 'stdio', stdio: { command: 'node', args: ['./dist/server.js', '--debug'] } },
      } as Partial<FrontMcpConfigParsed>);
      expect(buildInspectorArgs(config)).toEqual([
        '-y',
        '@modelcontextprotocol/inspector',
        '--transport',
        'stdio',
        '--',
        'node',
        './dist/server.js',
        '--debug',
      ]);
    });

    it('omits args when stdio.args is missing or empty', () => {
      const config = baseConfig({
        transport: { default: 'stdio', stdio: { command: 'mcp-server' } },
      } as Partial<FrontMcpConfigParsed>);
      expect(buildInspectorArgs(config)).toEqual([
        '-y',
        '@modelcontextprotocol/inspector',
        '--transport',
        'stdio',
        '--',
        'mcp-server',
      ]);
    });

    it('never emits the legacy --server-command or --server-args flags', () => {
      const config = baseConfig({
        transport: { default: 'stdio', stdio: { command: 'node', args: ['x.js'] } },
      } as Partial<FrontMcpConfigParsed>);
      const args = buildInspectorArgs(config);
      expect(args).not.toContain('--server-command');
      expect(args).not.toContain('--server-args');
    });

    it('falls back to the bare launcher when stdio.command is missing', () => {
      const config = baseConfig({ transport: { default: 'stdio' } } as Partial<FrontMcpConfigParsed>);
      expect(buildInspectorArgs(config)).toEqual(['-y', '@modelcontextprotocol/inspector']);
    });
  });
});

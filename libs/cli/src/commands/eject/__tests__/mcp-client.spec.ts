/**
 * Snippet emitter tests for the `eject` command (issue #400).
 *
 * Covers the four branches in `buildServerEntry`:
 *   1. Missing `clients.<name>` entry → throws.
 *   2. `transport: 'stdio'` → emits `command` + `args` (+ env when present),
 *      defaulting to `npx -y <config.name>`.
 *   3. `transport: 'http' | 'sse'` → emits `url` + `transport`, deriving the
 *      URL from `transport.http.port` or a single deployment HTTP port.
 *   4. Missing URL — both the "no port at all" and "ambiguous (multiple
 *      ports)" error shapes.
 *
 * Also asserts the `mcpServers` wrapping shape used by every supported
 * client (claude-code/desktop, cursor, windsurf, vscode).
 */

import type { FrontMcpConfigParsed } from '../../../config';
import { buildClientPayload, emitClientSnippet, mergeClientConfig } from '../mcp-client';

function baseConfig(overrides: Partial<FrontMcpConfigParsed> = {}): FrontMcpConfigParsed {
  return {
    name: 'demo',
    deployments: [{ target: 'node' }],
    ...overrides,
  } as FrontMcpConfigParsed;
}

describe('emitClientSnippet (issue #400)', () => {
  describe('missing client entry', () => {
    it('throws an Error with a helpful message when the requested client is absent', () => {
      const config = baseConfig();
      const act = () => emitClientSnippet('claude-code', config);
      expect(act).toThrow(Error);
      expect(act).toThrow(/no `clients\.claude-code` entry/);
    });
  });

  describe('stdio transport', () => {
    it("defaults to `npx -y <config.name>` when command/args aren't provided", () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'stdio' } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo).toEqual({ command: 'npx', args: ['-y', 'demo'] });
    });

    it('respects explicit command + args + env', () => {
      const config = baseConfig({
        clients: {
          'claude-code': {
            transport: 'stdio',
            command: 'node',
            args: ['./dist/server.js'],
            env: { LOG_LEVEL: 'debug' },
          },
        },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo).toEqual({
        command: 'node',
        args: ['./dist/server.js'],
        env: { LOG_LEVEL: 'debug' },
      });
    });

    it('omits `env` when the connection.env object is empty', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'stdio', env: {} } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo).not.toHaveProperty('env');
    });

    it('uses connection.name as the `mcpServers` key when provided', () => {
      const config = baseConfig({
        clients: { 'claude-code': { name: 'my-server', transport: 'stdio' } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers).toHaveProperty('my-server');
      expect(snippet.mcpServers).not.toHaveProperty('demo');
    });
  });

  describe('http / sse transport', () => {
    it('derives the URL from transport.http when provided', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'http' } },
        transport: { default: 'http', http: { port: 4321, path: '/mcp' } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo).toEqual({ url: 'http://127.0.0.1:4321/mcp', transport: 'http' });
    });

    it('respects explicit connection.url over derived fallback', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'http', url: 'https://example.com/mcp' } },
        transport: { default: 'http', http: { port: 4321 } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo.url).toBe('https://example.com/mcp');
    });

    it('derives the URL from a single deployment HTTP port when transport.http is absent', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'sse' } },
        deployments: [{ target: 'node', server: { http: { port: 9000 } } }],
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo).toEqual({ url: 'http://127.0.0.1:9000/mcp', transport: 'sse' });
    });

    it('uses the configured host + path when deriving from a port', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'http' } },
        transport: { default: 'http', http: { port: 4321, host: '0.0.0.0', path: '/api/mcp' } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo.url).toBe('http://0.0.0.0:4321/api/mcp');
    });

    it('throws an Error when no URL can be derived and there are no deployment ports', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'http' } },
      } as Partial<FrontMcpConfigParsed>);
      const act = () => emitClientSnippet('claude-code', config);
      expect(act).toThrow(Error);
      expect(act).toThrow(/needs a `url`/);
    });

    it('throws an Error with an unambiguous message when multiple deployment ports exist and url is absent', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'http' } },
        deployments: [
          { target: 'node', server: { http: { port: 9000 } } },
          { target: 'vercel', server: { http: { port: 9001 } } },
        ],
      } as Partial<FrontMcpConfigParsed>);
      const act = () => emitClientSnippet('claude-code', config);
      expect(act).toThrow(Error);
      expect(act).toThrow(/required when multiple deployment HTTP ports are configured/);
    });

    it('propagates connection.env to the emitted entry when non-empty', () => {
      const config = baseConfig({
        clients: { 'claude-code': { transport: 'http', url: 'https://example.com/mcp', env: { TOKEN: 'abc' } } },
      } as Partial<FrontMcpConfigParsed>);
      const snippet = JSON.parse(emitClientSnippet('claude-code', config));
      expect(snippet.mcpServers.demo.env).toEqual({ TOKEN: 'abc' });
    });
  });

  describe('snippet shape', () => {
    it('wraps the entry in `{ mcpServers: { … } }` for every supported client', () => {
      const config = baseConfig({
        clients: {
          'claude-code': { transport: 'stdio' },
          'claude-desktop': { transport: 'stdio' },
          cursor: { transport: 'stdio' },
          windsurf: { transport: 'stdio' },
          vscode: { transport: 'stdio' },
        },
      } as Partial<FrontMcpConfigParsed>);
      for (const client of ['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'vscode'] as const) {
        const snippet = JSON.parse(emitClientSnippet(client, config));
        expect(Object.keys(snippet)).toEqual(['mcpServers']);
        expect(snippet.mcpServers.demo).toEqual({ command: 'npx', args: ['-y', 'demo'] });
      }
    });
  });
});

describe('mergeClientConfig (#642)', () => {
  const payload = { mcpServers: { demo: { command: 'npx', args: ['-y', 'demo'] } } };

  it('creates the config when there is no existing file', () => {
    expect(JSON.parse(mergeClientConfig(undefined, payload))).toEqual(payload);
  });

  it('treats an empty file like a missing one', () => {
    expect(JSON.parse(mergeClientConfig('  \n', payload))).toEqual(payload);
  });

  it('keeps unrelated top-level keys and other servers', () => {
    const existing = JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'node', args: ['other.js'] } },
    });
    expect(JSON.parse(mergeClientConfig(existing, payload))).toEqual({
      theme: 'dark',
      mcpServers: { other: { command: 'node', args: ['other.js'] }, demo: payload.mcpServers.demo },
    });
  });

  it('replaces only the matching server entry', () => {
    const existing = JSON.stringify({ mcpServers: { demo: { command: 'old' }, other: { command: 'keep' } } });
    const merged = JSON.parse(mergeClientConfig(existing, payload));
    expect(merged.mcpServers.demo).toEqual(payload.mcpServers.demo);
    expect(merged.mcpServers.other).toEqual({ command: 'keep' });
  });

  it('adds mcpServers when the existing file has none', () => {
    expect(JSON.parse(mergeClientConfig('{"a":1}', payload))).toEqual({ a: 1, ...payload });
  });

  it('refuses to overwrite a file that is not valid JSON', () => {
    expect(() => mergeClientConfig('{oops', payload)).toThrow(/not valid JSON/);
  });

  it.each(['[]', '"text"', 'null', '42'])('refuses to overwrite non-object JSON %p', (text) => {
    expect(() => mergeClientConfig(text, payload)).toThrow(/not a JSON object/);
  });

  it('buildClientPayload matches the emitted snippet', () => {
    const config = {
      name: 'demo',
      deployments: [{ target: 'node' }],
      clients: { cursor: { transport: 'stdio' } },
    } as unknown as FrontMcpConfigParsed;
    expect(JSON.parse(emitClientSnippet('cursor', config))).toEqual(buildClientPayload('cursor', config));
  });
});

describe('env.shared / env.ship in stdio snippets (#680)', () => {
  it('passes env.shared ⊕ env.ship to the spawned server, with the client env winning', () => {
    const config = baseConfig({
      env: { shared: { LOG_LEVEL: 'info', API: 'shared' }, ship: { NODE_ENV: 'production', API: 'ship' }, dev: { X: '1' } },
      clients: { 'claude-desktop': { transport: 'stdio', env: { API: 'client' } } },
    } as Partial<FrontMcpConfigParsed>);
    const entry = buildClientPayload('claude-desktop', config).mcpServers['demo'];
    expect(entry.env).toEqual({ LOG_LEVEL: 'info', NODE_ENV: 'production', API: 'client' });
  });

  it('adds nothing to an http snippet (the client does not start the server)', () => {
    const config = baseConfig({
      env: { ship: { NODE_ENV: 'production' } },
      clients: { cursor: { transport: 'http', url: 'http://127.0.0.1:3000/mcp' } },
    } as Partial<FrontMcpConfigParsed>);
    expect(buildClientPayload('cursor', config).mcpServers['demo'].env).toBeUndefined();
  });
});


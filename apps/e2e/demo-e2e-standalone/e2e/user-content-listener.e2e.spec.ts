/**
 * E2E: the user-content listener (#1364), beside the MCP listener in one server process.
 *
 * - It serves the files under its root, with its own headers and content security policy.
 * - It never answers MCP or the API routes, and the MCP listener never serves the files.
 * - It checks Host on its own, and refuses paths outside its root, dotfiles and directory listings.
 * - SIGTERM closes both listeners.
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import { expect, TestServer } from '@frontmcp/testing';

// As long as TestServer waits for a server to exit (SERVER_EXIT_TIMEOUT_MS).
const EXIT_RECORD_TIMEOUT_MS = 12_000;

const SERVER_ENTRY = 'apps/e2e/demo-e2e-standalone/src/main-user-content.ts';

const INITIALIZE = {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'user-content-e2e', version: '1.0' },
    },
  }),
};

/** A port the OS has free now, outside the project's range the MCP listener takes its port from. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port')),
      );
    });
  });
}

/**
 * Resolves once `port` accepts a TCP connection. The server answers its MCP health check before the content listener,
 * which starts after it, is listening.
 */
async function waitForListener(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const accepted = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (accepted) return;
    if (Date.now() > deadline) throw new Error(`the content listener did not listen on port ${port}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Raw HTTP, which keeps a forged Host and an unnormalized path (`fetch` rewrites both). */
function rawGet(
  port: number,
  requestPath: string,
  host = `localhost:${port}`,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, headers: { host }, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('User-content listener (#1364)', () => {
  let directory: string;
  let server: TestServer | undefined;
  let mcpUrl: string;
  let contentPort: number;
  let contentUrl: string;
  let exitCodeFile: string;

  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fmcp-user-content-e2e-'));
    const root = path.join(directory, 'content');
    fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, 'frame.html'), '<!doctype html><p>user frame</p>');
    fs.writeFileSync(path.join(root, 'widget.js'), 'document.body.dataset.ready = "1";');
    fs.writeFileSync(path.join(root, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(root, 'nested', 'note.txt'), 'nested note');
    fs.writeFileSync(path.join(directory, 'outside.txt'), 'outside the root');
    exitCodeFile = path.join(directory, 'exit-code');

    contentPort = await freePort();
    server = await TestServer.start({
      command: `npx tsx ${SERVER_ENTRY}`,
      project: 'demo-e2e-standalone',
      env: {
        USER_CONTENT_PORT: String(contentPort),
        USER_CONTENT_ROOT: root,
        USER_CONTENT_EXIT_CODE_FILE: exitCodeFile,
      },
      startupTimeout: 60_000,
      debug: process.env['DEBUG'] === '1',
    });
    mcpUrl = server.info.baseUrl;
    contentUrl = `http://localhost:${contentPort}`;
    await waitForListener(contentPort);
  }, 90_000);

  afterAll(async () => {
    await server?.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('the content origin', () => {
    it('serves a file with its content type, headers and content security policy', async () => {
      const res = await fetch(`${contentUrl}/frame.html`);

      expect(res.status).toBe(200);
      expect(await res.text()).toBe('<!doctype html><p>user frame</p>');
      expect(res.headers.get('content-type')).toBe('text/html; charset=UTF-8');
      expect(res.headers.get('content-security-policy')).toBe(
        "default-src 'none'; img-src 'self'; sandbox allow-scripts",
      );
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBeNull();
      expect(res.headers.get('x-powered-by')).toBeNull();
    });

    it('sets the content type of scripts and images', async () => {
      expect((await fetch(`${contentUrl}/widget.js`)).headers.get('content-type')).toMatch(/javascript/);
      expect((await fetch(`${contentUrl}/logo.svg`)).headers.get('content-type')).toBe('image/svg+xml');
    });

    it('refuses an MCP request with 404', async () => {
      for (const endpoint of ['/mcp', '/']) {
        const res = await fetch(`${contentUrl}${endpoint}`, INITIALIZE);
        expect(res.status).toBe(404);
        expect(res.headers.get('mcp-session-id')).toBeNull();
        expect(await res.text()).not.toContain('serverInfo');
      }
    });

    it.each(['/health', '/healthz', '/.well-known/oauth-protected-resource', '/mcp/sse'])(
      'does not answer the API route %s',
      async (route) => {
        expect((await fetch(`${contentUrl}${route}`)).status).toBe(404);
      },
    );

    it('refuses a Host it does not answer to', async () => {
      const res = await rawGet(contentPort, '/frame.html', 'evil.attacker.example');

      expect(res.status).toBe(403);
      expect(res.body).not.toContain('user frame');
    });

    it.each(['/..%2foutside.txt', '/../outside.txt', '/nested/..%2f..%2foutside.txt'])(
      'never serves a file outside its root (%s)',
      async (requestPath) => {
        const res = await rawGet(contentPort, requestPath);

        expect(res.status).toBe(404);
        expect(res.body).not.toContain('outside the root');
      },
    );

    it('never serves a dotfile or lists a directory', async () => {
      expect((await rawGet(contentPort, '/.env')).status).toBe(404);
      for (const directoryPath of ['/', '/nested/']) {
        const res = await rawGet(contentPort, directoryPath);
        expect(res.status).toBe(404);
        expect(res.body).not.toContain('note.txt');
      }
    });
  });

  it('starts with the Node server, which does not say it ignores the option', () => {
    expect(server?.getLogs().join('\n')).not.toContain('http.userContent is ignored');
  });

  describe('the MCP listener', () => {
    it('serves MCP as before', async () => {
      const res = await fetch(`${mcpUrl}/mcp`, INITIALIZE);

      expect(res.status).toBe(200);
      expect(await res.text()).toContain('serverInfo');
    });

    it('does not serve the content files', async () => {
      for (const file of ['/frame.html', '/widget.js', '/nested/note.txt']) {
        const res = await fetch(`${mcpUrl}${file}`);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain('user frame');
      }
    });

    it('keeps its own headers', async () => {
      const res = await fetch(`${mcpUrl}/healthz`);

      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(res.headers.get('cross-origin-resource-policy')).toBeNull();
    });
  });

  it('closes both listeners on SIGTERM, shutting down gracefully', async () => {
    await server?.stop();
    server = undefined;

    // TestServer.stop() resolves on any exit, a SIGKILL after 5 s included. The server writes the code it exits with:
    // 0 once its graceful shutdown completed, 1 when a step failed or it outlasted its deadline, nothing when killed.
    // The server writes it in its 'exit' listener, which can run after the wrapper exits and the port closes.
    const exitCode = async () => (fs.existsSync(exitCodeFile) ? fs.readFileSync(exitCodeFile, 'utf8') : '');
    const deadline = Date.now() + EXIT_RECORD_TIMEOUT_MS;
    while (!(await exitCode()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await exitCode()).toBe('0');

    await expect(fetch(`${contentUrl}/frame.html`)).rejects.toThrow();
    await expect(fetch(`${mcpUrl}/healthz`)).rejects.toThrow();
  });
});

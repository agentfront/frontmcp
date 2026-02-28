/**
 * Playwright Test Helpers
 *
 * Utilities for serving HTML content via a local HTTP server
 * so Playwright can load and test it in a real browser.
 */
import * as http from 'http';
import { buildShell } from '@frontmcp/uipack';
import type { ShellConfig } from '@frontmcp/uipack';

let server: http.Server | null = null;
let serverUrl: string | null = null;

/**
 * Serve raw HTML on a random port and return the URL.
 */
export async function serveHtml(html: string): Promise<string> {
  await stopServer();

  return new Promise<string>((resolve, reject) => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server?.address();
      if (typeof addr === 'object' && addr !== null) {
        serverUrl = `http://127.0.0.1:${addr.port}`;
        resolve(serverUrl);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Build an HTML shell and serve it. Returns the URL and the shell result.
 */
export async function serveShell(
  content: string,
  config: Omit<ShellConfig, 'toolName'> & { toolName?: string },
): Promise<{ url: string; html: string; hash: string; size: number }> {
  const result = buildShell(content, {
    toolName: config.toolName ?? 'test-tool',
    ...config,
  });

  const url = await serveHtml(result.html);
  return { url, ...result };
}

/**
 * Stop the running HTTP server.
 */
export async function stopServer(): Promise<void> {
  if (server) {
    const s = server;
    return new Promise<void>((resolve) => {
      s.close(() => {
        server = null;
        serverUrl = null;
        resolve();
      });
    });
  }
}

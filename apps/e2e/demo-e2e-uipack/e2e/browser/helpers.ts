/**
 * Playwright Test Helpers
 *
 * Utilities for serving HTML content via a local HTTP server
 * so Playwright can load and test it in a real browser.
 */
import * as http from 'http';
import { buildShell, renderComponent } from '@frontmcp/uipack';
import type { ShellConfig, UIConfig, ImportResolver, ResolvedImport, ResolveContext } from '@frontmcp/uipack';

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

const LOCAL_ESM_SH_BASE = 'http://localhost:8088';

/**
 * Import resolver that routes all bare imports to the local esm.sh instance.
 * Skips relative imports, node: builtins, and # private imports.
 */
export const localEsmResolver: ImportResolver = {
  resolve(specifier: string, _context?: ResolveContext): ResolvedImport | null {
    if (
      specifier.startsWith('./') ||
      specifier.startsWith('../') ||
      specifier.startsWith('/') ||
      specifier.startsWith('node:') ||
      specifier.startsWith('#')
    ) {
      return null;
    }
    return { value: `${LOCAL_ESM_SH_BASE}/${specifier}`, type: 'url' };
  },
};

/**
 * Patch CSP meta tag in HTML to allow the local esm.sh domain.
 *
 * The CSP validator in uipack rejects http:// domains, so we post-process
 * the HTML to inject http://localhost:8088 into the relevant directives.
 * This is test-only; production CSP behavior is unmodified.
 */
function patchCspForLocalEsmSh(html: string): string {
  return html.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]+)(")/i,
    (_match, prefix: string, csp: string, suffix: string) => {
      const directives = ['script-src', 'style-src', 'img-src', 'font-src', 'connect-src'];
      let patched = csp;
      for (const directive of directives) {
        const re = new RegExp(`(${directive}\\s)([^;]+)`);
        patched = patched.replace(re, `$1$2 ${LOCAL_ESM_SH_BASE}`);
      }
      return `${prefix}${patched}${suffix}`;
    },
  );
}

/**
 * Render a component via renderComponent(), patch CSP for local esm.sh,
 * and serve the resulting HTML. Returns the URL and raw HTML.
 */
export async function serveComponent(
  uiConfig: UIConfig,
  shellConfig: Omit<ShellConfig, 'toolName'> & { toolName?: string },
): Promise<{ url: string; html: string }> {
  const result = renderComponent(uiConfig, {
    toolName: shellConfig.toolName ?? 'test-tool',
    resolver: localEsmResolver,
    ...shellConfig,
  });

  const html = patchCspForLocalEsmSh(result.html);
  const url = await serveHtml(html);
  return { url, html };
}

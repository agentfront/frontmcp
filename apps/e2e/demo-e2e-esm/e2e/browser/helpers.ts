/**
 * Playwright Test Helpers for ESM Browser E2E
 *
 * Serves HTML pages with import maps that allow ESM bundles with
 * externalized imports (@frontmcp/sdk, zod) to resolve in the browser.
 */
import * as http from 'node:http';

let server: http.Server | null = null;

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
        resolve(`http://127.0.0.1:${addr.port}`);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}

/**
 * Build an HTML page that loads an ESM bundle via import map.
 *
 * @param esmServerUrl - URL of the local ESM package server
 * @param packageSpec - Package specifier (e.g., '@test/esm-tools@1.0.0')
 */
export function buildEsmTestPage(esmServerUrl: string, packageSpec: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>ESM Browser Test</title>
</head>
<body>
  <div id="result"></div>
  <script type="module">
    // In browser, we fetch the bundle directly and evaluate it as a self-contained module.
    // The ESM package server serves CJS bundles that use module.exports = { default: { ... } }.
    // For browser testing, we fetch the bundle text, wrap it in a Function, and execute it.
    try {
      const res = await fetch('${esmServerUrl}/${packageSpec}');
      if (!res.ok) throw new Error('Failed to fetch bundle: ' + res.status);
      const bundleText = await res.text();

      // Execute the CJS bundle in a sandboxed scope
      const module = { exports: {} };
      const wrappedFn = new Function('module', 'exports', bundleText);
      wrappedFn(module, module.exports);

      const manifest = module.exports.default || module.exports;

      // Extract tool names and call the first tool
      const toolNames = (manifest.tools || []).map(t => t.name);
      const results = {};

      // Call echo tool if it exists
      const echoTool = (manifest.tools || []).find(t => t.name === 'echo');
      if (echoTool) {
        const echoResult = await echoTool.execute({ message: 'browser-test' });
        results.echo = echoResult;
      }

      // Call add tool if it exists
      const addTool = (manifest.tools || []).find(t => t.name === 'add');
      if (addTool) {
        const addResult = await addTool.execute({ a: 7, b: 8 });
        results.add = addResult;
      }

      document.getElementById('result').textContent = JSON.stringify({
        success: true,
        name: manifest.name,
        version: manifest.version,
        toolNames,
        results,
      });
    } catch (err) {
      document.getElementById('result').textContent = JSON.stringify({
        success: false,
        error: err.message,
      });
    }
  </script>
</body>
</html>`;
}

/**
 * Stop the running HTTP server.
 */
export async function stopServer(): Promise<void> {
  if (server) {
    return new Promise<void>((resolve) => {
      server?.close(() => {
        server = null;
        resolve();
      });
    });
  }
}

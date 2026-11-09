/**
 * Playwright: the page a URL-served widget's ui:// resource is
 *
 * A simulated MCP Apps host frames the shell, the shell frames the widget page on another origin,
 * and the widget's bridge completes the MCP Apps handshake and gets the tool result through the
 * shell's relay.
 */
import * as http from 'http';

import { expect, test } from '@playwright/test';

import { buildShell, buildUrlWidgetShell } from '@frontmcp/uipack';

interface Served {
  url: string;
  close: () => Promise<void>;
}

async function serve(
  host: '127.0.0.1' | 'localhost',
  body: (origin: string) => string,
  headers: Record<string, string> = {},
): Promise<Served> {
  let origin = '';
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
    res.end(body(origin));
  });
  await new Promise<void>((resolve) => server.listen(0, host === 'localhost' ? '127.0.0.1' : host, resolve));
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('no address');
  origin = `http://${host}:${address.port}`;
  return { url: origin, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

const WIDGET_CONTENT = `<div id="forecast-widget">waiting</div>
<script>
  window.addEventListener('tool:result', function (event) {
    var data = event.detail.structuredContent;
    document.getElementById('forecast-widget').textContent = data.city + ' ' + data.high;
  });
</script>`;

function hostPage(shellUrl: string): string {
  return `<!DOCTYPE html><html><body>
<iframe id="view" src="${shellUrl}" style="width:400px;height:200px"></iframe>
<script>
  window.received = [];
  var view = document.getElementById('view');
  window.addEventListener('message', function (event) {
    if (event.source !== view.contentWindow) return;
    var message = event.data;
    window.received.push(message.method || 'response');
    if (message.method === 'ui/initialize') {
      view.contentWindow.postMessage({ jsonrpc: '2.0', id: message.id, result: {
        protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1.0.0' },
        hostCapabilities: {}, hostContext: { theme: 'light' } } }, '*');
    } else if (message.method === 'ui/notifications/initialized') {
      view.contentWindow.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result',
        params: { content: [], structuredContent: { city: 'Lisbon', high: 24 } } }, '*');
    }
  });
</script></body></html>`;
}

test.describe('URL widget shell', () => {
  const servers: Served[] = [];

  test.afterEach(async () => {
    await Promise.all(servers.splice(0).map((served) => served.close()));
  });

  test('relays the MCP Apps handshake and the tool result between the host and the framed widget', async ({ page }) => {
    const widget = await serve('127.0.0.1', () => buildShell(WIDGET_CONTENT, { toolName: 'forecast' }).html);
    const shell = await serve('localhost', () => buildUrlWidgetShell({ url: `${widget.url}/`, title: 'forecast' }));
    const host = await serve('127.0.0.1', () => hostPage(`${shell.url}/`));
    servers.push(widget, shell, host);

    await page.goto(`${host.url}/`);

    const widgetText = page.frameLocator('#view').frameLocator('#frontmcp-widget').locator('#forecast-widget');
    await expect(widgetText).toHaveText('Lisbon 24', { timeout: 15_000 });
    const received = await page.evaluate(() => (window as unknown as { received: string[] }).received);
    expect(received).toEqual(expect.arrayContaining(['ui/initialize', 'ui/notifications/initialized']));
  });

  test('says so in place of the widget when the host does not allow the frame', async ({ page }) => {
    const widget = await serve('127.0.0.1', () => buildShell(WIDGET_CONTENT, { toolName: 'forecast' }).html);
    const shell = await serve('localhost', () => buildUrlWidgetShell({ url: `${widget.url}/` }), {
      'Content-Security-Policy': "frame-src 'none'",
    });
    const host = await serve('127.0.0.1', () => hostPage(`${shell.url}/`));
    servers.push(widget, shell, host);

    await page.goto(`${host.url}/`);

    await expect(page.frameLocator('#view').locator('#frontmcp-widget-blocked')).toHaveText(
      `This widget loads from ${widget.url}, which this host does not allow.`,
      { timeout: 15_000 },
    );
  });
});

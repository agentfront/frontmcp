import { buildUrlWidgetShell, widgetUrlOrigin } from '../url-widget-shell';

describe('widgetUrlOrigin', () => {
  it('returns the origin of an https or http URL', () => {
    expect(widgetUrlOrigin('https://cdn.example.com/widgets/weather.html?v=2')).toBe('https://cdn.example.com');
    expect(widgetUrlOrigin('http://localhost:3000/widgets/weather')).toBe('http://localhost:3000');
  });

  it.each(['/widgets/weather', 'javascript:alert(1)', 'data:text/html,<p>x</p>', 'not a url'])('refuses %s', (url) => {
    expect(() => widgetUrlOrigin(url)).toThrow(/Widget URL/);
  });
});

describe('buildUrlWidgetShell', () => {
  const page = buildUrlWidgetShell({ url: 'https://mcp.example.com/widgets/weather', title: 'weather' });

  it('frames the widget URL', () => {
    expect(page).toContain(
      '<iframe id="frontmcp-widget" src="https://mcp.example.com/widgets/weather" title="weather">',
    );
  });

  it("allows only the widget's origin as a frame in its own policy", () => {
    expect(page).toContain(
      `content="default-src &#39;none&#39;; script-src &#39;unsafe-inline&#39;; style-src &#39;unsafe-inline&#39;; frame-src https://mcp.example.com"`,
    );
  });

  it('relays messages to the widget addressed to its origin only', () => {
    expect(page).toContain('var widgetOrigin = "https://mcp.example.com";');
    expect(page).toContain('frame.contentWindow.postMessage(event.data, widgetOrigin)');
    expect(page).toContain('if (event.origin !== widgetOrigin) return;');
  });

  it('normalizes and escapes the URL, and escapes the title', () => {
    const escaped = buildUrlWidgetShell({ url: 'https://cdn.example.com/w?a=1&b="2"', title: '<b>x</b>' });
    expect(escaped).toContain('src="https://cdn.example.com/w?a=1&amp;b=%222%22"');
    expect(escaped).toContain('<title>&lt;b&gt;x&lt;/b&gt;</title>');
    expect(escaped).not.toContain('<b>x</b>');
  });

  it('refuses a URL that is not http or https', () => {
    expect(() => buildUrlWidgetShell({ url: 'javascript:alert(1)' })).toThrow(/must use https:/);
  });
});

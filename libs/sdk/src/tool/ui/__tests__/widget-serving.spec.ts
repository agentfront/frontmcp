import { defaultWidgetPath, describeWidgetServingProblems, widgetPathOf, widgetUrlSourceOf } from '../widget-serving';

describe('defaultWidgetPath', () => {
  it('serves a widget under /widgets/ and its tool name', () => {
    expect(defaultWidgetPath('get_weather')).toBe('/widgets/get_weather');
    expect(defaultWidgetPath('reports/sales')).toBe('/widgets/reports/sales');
  });

  it('replaces characters a route path cannot hold literally', () => {
    expect(defaultWidgetPath('billing:invoice@v2')).toBe('/widgets/billing-invoice-v2');
    expect(defaultWidgetPath('a//b')).toBe('/widgets/a/-/b');
  });
});

describe('widgetPathOf', () => {
  it("takes the tool's directPath, without a trailing slash", () => {
    expect(widgetPathOf('weather', { directPath: '/w/weather/' })).toBe('/w/weather');
    expect(widgetPathOf('weather', {})).toBe('/widgets/weather');
  });
});

describe('describeWidgetServingProblems', () => {
  it('accepts a direct-url widget with or without a directPath', () => {
    expect(describeWidgetServingProblems('weather', {}, 'direct-url')).toEqual([]);
    expect(describeWidgetServingProblems('weather', { directPath: '/widgets/weather.v2' }, 'direct-url')).toEqual([]);
    expect(describeWidgetServingProblems('weather', { directPath: '/a/b/' }, 'direct-url')).toEqual([]);
  });

  it.each(['inline', 'static', 'auto', 'hybrid'] as const)(
    "refuses a directPath on a widget served '%s', which nothing would serve",
    (mode) => {
      expect(describeWidgetServingProblems('weather', { directPath: '/widgets/weather' }, mode)).toEqual([
        `Tool "weather": \`ui.directPath\` is set, but the widget is served '${mode}', so nothing serves that path. ` +
          "Set `ui.servingMode: 'direct-url'`, or remove `ui.directPath`.",
      ]);
    },
  );

  it.each([
    ['widgets/weather', 'must start with "/"'],
    ['/', 'must start with "/"'],
    ['/widgets/../admin', 'without "." or ".." segments'],
    ['/widgets/./weather', 'without "." or ".." segments'],
    ['/widgets//weather', 'non-empty segments'],
    ['/widgets/:id', 'may hold only'],
    ['/widgets/*', 'may hold only'],
    ['/widgets/a b', 'may hold only'],
    ['/widgets/%2e%2e', 'may hold only'],
    ['/widgets/weather?x=1', 'may hold only'],
    [`/${'a'.repeat(600)}`, 'longer than 512'],
    [42, 'is not a string'],
  ])('refuses the directPath %p', (directPath, reason) => {
    const [problem] = describeWidgetServingProblems('weather', { directPath }, 'direct-url');
    expect(problem).toContain('Tool "weather": `ui.directPath`');
    expect(problem).toContain(reason);
  });
});

describe("describeWidgetServingProblems for 'custom-url'", () => {
  it('accepts an https URL, or http on localhost, with a query and a fragment', () => {
    for (const customWidgetUrl of [
      'https://cdn.example.com/widgets/weather.html?v=3#top',
      'http://localhost:5173/weather.html',
      'http://127.0.0.1:5173/weather.html',
    ]) {
      expect(describeWidgetServingProblems('weather', { customWidgetUrl }, 'custom-url')).toEqual([]);
    }
  });

  it("refuses a 'custom-url' widget without a customWidgetUrl, its own mode or an inherited one", () => {
    expect(describeWidgetServingProblems('weather', {}, 'custom-url')).toEqual([
      'Tool "weather": `ui.servingMode: \'custom-url\'` needs `ui.customWidgetUrl`, the URL of the widget page.',
    ]);
  });

  it("refuses a customWidgetUrl on a widget that isn't served 'custom-url'", () => {
    expect(
      describeWidgetServingProblems('weather', { customWidgetUrl: 'https://cdn.example.com/w.html' }, 'static'),
    ).toEqual([
      'Tool "weather": `ui.customWidgetUrl` is set, but the widget is served \'static\', so nothing loads that URL. ' +
        "Set `ui.servingMode: 'custom-url'`, or remove `ui.customWidgetUrl`.",
    ]);
  });

  it.each([
    ['https://cdn.example.com/w.html?token={token}', 'has a `{…}` placeholder, which FrontMCP does not fill'],
    ['https://cdn.example.com/{tool}.html', 'has a `{…}` placeholder'],
    ['http://cdn.example.com/w.html', 'must be an https:// URL (or http:// on localhost)'],
    ['javascript:alert(1)', 'must be an https:// URL'],
    ['data:text/html,<p>x</p>', 'must be an https:// URL'],
    ['/widgets/weather.html', 'is not an absolute URL'],
    ['https://user:secret@cdn.example.com/w.html', 'must not hold credentials'],
    [`https://cdn.example.com/${'a'.repeat(2100)}`, 'is longer than 2048 characters'],
    [42, 'is not a string'],
  ])('refuses the customWidgetUrl %p', (customWidgetUrl, reason) => {
    const [problem] = describeWidgetServingProblems('weather', { customWidgetUrl }, 'custom-url');
    expect(problem).toContain('Tool "weather": `ui.customWidgetUrl`');
    expect(problem).toContain(reason);
  });

  it('never repeats the URL in a refusal, as it may hold a credential or a key', () => {
    for (const customWidgetUrl of [
      'https://user:secret@cdn.example.com/w.html',
      'http://cdn.example.com/w.html?key=secret',
      'https://cdn.example.com/w.html?key=secret&t={token}',
    ]) {
      const [problem] = describeWidgetServingProblems('weather', { customWidgetUrl }, 'custom-url');
      expect(problem).not.toContain('secret');
    }
  });
});

describe('widgetUrlSourceOf', () => {
  it('names the route of a direct-url widget and the URL of a custom-url one', () => {
    expect(widgetUrlSourceOf('weather', {}, 'direct-url')).toEqual({
      servingMode: 'direct-url',
      path: '/widgets/weather',
    });
    expect(widgetUrlSourceOf('weather', { customWidgetUrl: 'https://cdn.example.com/w.html' }, 'custom-url')).toEqual({
      servingMode: 'custom-url',
      url: 'https://cdn.example.com/w.html',
    });
    expect(widgetUrlSourceOf('weather', {}, 'static')).toBeUndefined();
  });
});

describe("describeWidgetServingProblems for 'bundlingMode'", () => {
  it.each([
    [undefined, 'dynamic'],
    ['auto', 'dynamic'],
    ['inline', 'dynamic'],
    [undefined, 'static'],
    ['auto', 'static'],
    ['static', 'static'],
    ['hybrid', 'static'],
    ['direct-url', 'static'],
  ])('accepts servingMode %p with bundlingMode %p', (servingMode, bundlingMode) => {
    expect(describeWidgetServingProblems('weather', { servingMode, bundlingMode }, 'auto')).toEqual([]);
  });

  it.each(['static', 'hybrid', 'direct-url', 'custom-url'])(
    "refuses bundlingMode 'dynamic' with the tool's own servingMode '%s', which builds the page once",
    (servingMode) => {
      expect(describeBundling(servingMode, 'dynamic')).toEqual([
        `Tool "weather": \`ui.bundlingMode: 'dynamic'\` renders the page for each call, but \`ui.servingMode: '${servingMode}'\` ` +
          "builds it once. Remove one, or make them agree: 'dynamic' goes with 'inline', and 'static' with " +
          "'static', 'hybrid', 'direct-url' or 'custom-url'.",
      ]);
    },
  );

  it("refuses bundlingMode 'static' with the tool's own servingMode 'inline'", () => {
    expect(describeBundling('inline', 'static')).toEqual([
      "Tool \"weather\": `ui.bundlingMode: 'static'` builds the page once, at startup, but `ui.servingMode: 'inline'` " +
        "renders it for each call. Remove one, or make them agree: 'dynamic' goes with 'inline', and 'static' with " +
        "'static', 'hybrid', 'direct-url' or 'custom-url'.",
    ]);
  });

  it('refuses a value other than static or dynamic', () => {
    expect(describeBundling(undefined, 'lazy')).toEqual([
      'Tool "weather": `ui.bundlingMode` is "lazy"; use \'static\' or \'dynamic\'.',
    ]);
  });

  function describeBundling(servingMode: string | undefined, bundlingMode: string): string[] {
    const ui = { servingMode, bundlingMode, customWidgetUrl: 'https://cdn.example.com/w.html' };
    return describeWidgetServingProblems('weather', ui, servingMode === 'custom-url' ? 'custom-url' : 'static').filter(
      (problem) => problem.includes('bundlingMode'),
    );
  }
});

import { defaultWidgetPath, describeWidgetServingProblems, widgetPathOf } from '../widget-serving';

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

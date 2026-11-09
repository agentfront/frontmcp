import { describeIgnoredUiOptions } from '../ui-option-warnings';

describe('describeIgnoredUiOptions (#645)', () => {
  it('returns nothing without a ui config or with only working options', () => {
    expect(describeIgnoredUiOptions('t', undefined)).toEqual([]);
    expect(describeIgnoredUiOptions('t', { template: 'x', servingMode: 'static', csp: {} })).toEqual([]);
    expect(describeIgnoredUiOptions('t', { servingMode: 'inline' })).toEqual([]);
  });

  it('names a single ignored option in the singular', () => {
    const [message] = describeIgnoredUiOptions('weather', { bundlingMode: 'static' });
    expect(message).toContain('Tool "weather"');
    expect(message).toContain('`ui.bundlingMode` is deprecated and has no effect; remove it.');
  });

  it('lists several ignored options in one message', () => {
    const messages = describeIgnoredUiOptions('weather', { htmlResponsePrefix: 'x', bundlingMode: 'x' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`ui.bundlingMode`, `ui.htmlResponsePrefix`');
    expect(messages[0]).toContain('are deprecated and have no effect; remove them.');
  });

  it('says nothing about the URL serving modes and their options, which serve the widget from a URL', () => {
    expect(describeIgnoredUiOptions('weather', { servingMode: 'direct-url', directPath: '/widgets/weather' })).toEqual(
      [],
    );
    expect(
      describeIgnoredUiOptions('weather', {
        servingMode: 'custom-url',
        customWidgetUrl: 'https://cdn.example.com/weather.html',
      }),
    ).toEqual([]);
  });

  it('says nothing about the options sent to the host', () => {
    expect(
      describeIgnoredUiOptions('weather', {
        widgetDescription: 'd',
        widgetAccessible: true,
        displayMode: 'fullscreen',
        prefersBorder: true,
        sandboxDomain: 'https://weather.example',
      }),
    ).toEqual([]);
  });

  it('says hybrid sends only a component reference', () => {
    const messages = describeIgnoredUiOptions('t', { servingMode: 'hybrid' });
    expect(messages).toEqual([expect.stringContaining("sends only a reference in `_meta['ui/component']`")]);
  });

  it('names each ui.csp origin the widget page cannot list (#681)', () => {
    const messages = describeIgnoredUiOptions('live', {
      csp: {
        connectDomains: ['wss://live.example.com', 'ftp://files.example.com', 'http://localhost:4000'],
        resourceDomains: ['cdn.example.com', 42],
      },
    });

    expect(messages).toEqual([
      expect.stringContaining('`ui.csp.connectDomains` origin "ftp://files.example.com"'),
      expect.stringContaining('`ui.csp.resourceDomains` origin "cdn.example.com"'),
      expect.stringContaining('`ui.csp.resourceDomains` origin 42'),
    ]);
    expect(messages[0]).toContain('Tool "live"');
  });

  it('accepts a csp without domain lists', () => {
    expect(describeIgnoredUiOptions('t', { csp: { connectDomains: 'https://x.example.com' } })).toEqual([]);
    expect(describeIgnoredUiOptions('t', { csp: null })).toEqual([]);
  });
});

import { describeIgnoredUiOptions } from '../ui-option-warnings';

describe('describeIgnoredUiOptions (#645)', () => {
  it('returns nothing without a ui config or with only working options', () => {
    expect(describeIgnoredUiOptions('t', undefined)).toEqual([]);
    expect(describeIgnoredUiOptions('t', { template: 'x', servingMode: 'static', csp: {} })).toEqual([]);
    expect(describeIgnoredUiOptions('t', { servingMode: 'inline' })).toEqual([]);
  });

  it('names a single ignored option in the singular', () => {
    const [message] = describeIgnoredUiOptions('weather', { hydrate: true });
    expect(message).toContain('Tool "weather"');
    expect(message).toContain('`ui.hydrate` is accepted but not used yet');
  });

  it('lists several ignored options in one message', () => {
    const messages = describeIgnoredUiOptions('weather', { uiType: 'html', hydrate: true, bundlingMode: 'x' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`ui.hydrate`, `ui.bundlingMode`, `ui.uiType`');
    expect(messages[0]).toContain('are accepted but not used yet');
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

  it.each(['direct-url', 'custom-url'])('flags servingMode %s as not implemented', (servingMode) => {
    const messages = describeIgnoredUiOptions('t', { servingMode });
    expect(messages).toEqual([expect.stringContaining(`servingMode: '${servingMode}'\` is not implemented`)]);
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

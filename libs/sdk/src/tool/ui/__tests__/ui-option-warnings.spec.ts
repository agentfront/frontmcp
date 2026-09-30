import { describeIgnoredUiOptions } from '../ui-option-warnings';

describe('describeIgnoredUiOptions (#645)', () => {
  it('returns nothing without a ui config or with only working options', () => {
    expect(describeIgnoredUiOptions('t', undefined)).toEqual([]);
    expect(describeIgnoredUiOptions('t', { template: 'x', servingMode: 'static', csp: {} })).toEqual([]);
    expect(describeIgnoredUiOptions('t', { servingMode: 'inline' })).toEqual([]);
  });

  it('names a single ignored option in the singular', () => {
    const [message] = describeIgnoredUiOptions('weather', { prefersBorder: true });
    expect(message).toContain('Tool "weather"');
    expect(message).toContain('`ui.prefersBorder` is accepted but not used yet');
  });

  it('lists several ignored options in one message', () => {
    const messages = describeIgnoredUiOptions('weather', { widgetDescription: 'd', hydrate: true, bundlingMode: 'x' });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('`ui.widgetDescription`, `ui.hydrate`, `ui.bundlingMode`');
    expect(messages[0]).toContain('are accepted but not used yet');
  });

  it.each(['direct-url', 'custom-url'])('flags servingMode %s as not implemented', (servingMode) => {
    const messages = describeIgnoredUiOptions('t', { servingMode });
    expect(messages).toEqual([expect.stringContaining(`servingMode: '${servingMode}'\` is not implemented`)]);
  });

  it('says hybrid sends only a component reference', () => {
    const messages = describeIgnoredUiOptions('t', { servingMode: 'hybrid' });
    expect(messages).toEqual([expect.stringContaining("sends only a reference in `_meta['ui/component']`")]);
  });
});

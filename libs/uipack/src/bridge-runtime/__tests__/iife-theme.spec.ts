/**
 * @jest-environment jsdom
 */
/**
 * The page follows the host theme (#649, and #645's `useTheme` / `useHostContext`).
 *
 * The theme an MCP Apps host sends — in the `ui/initialize` result or a later
 * `ui/notifications/host-context-changed` — is written to
 * `<meta name="color-scheme">` and `<html data-theme>`. The meta, rather than an
 * inline style, leaves a widget's own `:root { color-scheme }` in charge. The OS
 * fallback the bridge starts with is never written.
 */
import { createBridgeFrame, type BridgeFrame } from './bridge-frame';

describe.each([
  ['minified', true],
  ['unminified', false],
])('bridge host theme (%s)', (_label, minify) => {
  let frame: BridgeFrame | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
  });

  async function open(headHtml?: string): Promise<BridgeFrame> {
    frame = createBridgeFrame({ minify, headHtml, bodyHtml: '<div id="root"></div>' });
    await frame.settle();
    return frame;
  }

  function colorSchemeMetas(f: BridgeFrame): HTMLMetaElement[] {
    return Array.from(f.doc.querySelectorAll<HTMLMetaElement>('meta[name="color-scheme"]'));
  }

  it('applies the handshake theme to <meta name="color-scheme"> and data-theme before bridge:ready', async () => {
    const f = await open();
    let atReady: { meta: string | null; dataTheme: string | null } | undefined;
    f.win.addEventListener('bridge:ready', () => {
      atReady = {
        meta: f.doc.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ?? null,
        dataTheme: f.doc.documentElement.getAttribute('data-theme'),
      };
    });

    await f.answer('ui/initialize', { hostCapabilities: {}, hostContext: { theme: 'dark' } });

    const metas = colorSchemeMetas(f);
    expect(metas).toHaveLength(1);
    expect(metas[0].getAttribute('content')).toBe('dark');
    expect(f.doc.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(atReady).toEqual({ meta: 'dark', dataTheme: 'dark' });
    expect(f.bridge.getTheme()).toBe('dark');
  });

  it('follows a host-context-changed notification', async () => {
    const f = await open();
    await f.answer('ui/initialize', { hostCapabilities: {}, hostContext: { theme: 'dark' } });

    await f.notify('ui/notifications/host-context-changed', { theme: 'light' });

    const metas = colorSchemeMetas(f);
    expect(metas).toHaveLength(1);
    expect(metas[0].getAttribute('content')).toBe('light');
    expect(f.doc.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('notifies onContextChange listeners with the handshake context', async () => {
    const f = await open();
    const listener = jest.fn();
    f.bridge.onContextChange(listener);

    await f.answer('ui/initialize', {
      hostCapabilities: {},
      hostContext: { theme: 'dark', displayMode: 'inline' },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark', displayMode: 'inline' }));
    expect(f.bridge.getHostContext()).toMatchObject({ theme: 'dark' });
  });

  it('writes nothing when the host sends no theme', async () => {
    const f = await open();
    await f.answer('ui/initialize', { hostCapabilities: {}, hostContext: { displayMode: 'inline' } });

    expect(colorSchemeMetas(f)).toHaveLength(0);
    expect(f.doc.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('writes nothing for a theme that is not light or dark', async () => {
    const f = await open();
    await f.answer('ui/initialize', { hostCapabilities: {}, hostContext: { theme: 'sepia' } });

    expect(colorSchemeMetas(f)).toHaveLength(0);
    expect(f.doc.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it("updates the widget's own color-scheme meta instead of adding a second one", async () => {
    const f = await open('<meta name="color-scheme" content="light dark">');
    await f.answer('ui/initialize', { hostCapabilities: {}, hostContext: { theme: 'dark' } });

    const metas = colorSchemeMetas(f);
    expect(metas).toHaveLength(1);
    expect(metas[0].getAttribute('content')).toBe('dark');
  });
});

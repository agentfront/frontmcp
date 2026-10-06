/**
 * @jest-environment jsdom
 */
/**
 * `ui.displayMode` reaches the page as `window.__mcpDisplayMode`, and the bridge asks the host for
 * it once it connects: `ui/request-display-mode` in an MCP Apps host that offers the mode in
 * `hostContext.availableDisplayModes`, and `window.openai.requestDisplayMode({ mode })` under the
 * OpenAI Apps SDK. `ui/initialize` declares the modes the widget supports, and the bridge keeps the
 * mode the host answers with, which can differ from the one asked for.
 */
import { buildDataInjectionScript } from '../../shell/data-injector';
import { createBridgeFrame, type BridgeFrame, type FrameWindow } from './bridge-frame';

describe('bridge display mode', () => {
  let frame: BridgeFrame | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
  });

  function setDisplayMode(mode: string): (win: FrameWindow) => void {
    return (win) => {
      win.eval(buildDataInjectionScript({ toolName: 'dashboard', displayMode: mode }).replace(/<\/?script>/g, ''));
    };
  }

  it('declares the display modes it supports in ui/initialize', async () => {
    frame = createBridgeFrame();
    await frame.settle();

    expect(frame.requests('ui/initialize')[0].params?.['appCapabilities']).toEqual(
      expect.objectContaining({ availableDisplayModes: ['inline', 'fullscreen', 'pip'] }),
    );
  });

  it('asks an MCP Apps host for the configured mode once the handshake completes', async () => {
    frame = createBridgeFrame({ beforeBridge: setDisplayMode('fullscreen') });
    await frame.settle();
    expect(frame.requests('ui/request-display-mode')).toEqual([]);

    await frame.answer('ui/initialize', {
      hostCapabilities: {},
      hostContext: { availableDisplayModes: ['inline', 'fullscreen'] },
    });

    expect(frame.requests('ui/request-display-mode').map((request) => request.params)).toEqual([
      { mode: 'fullscreen' },
    ]);
  });

  it.each([{ availableDisplayModes: ['inline'] }, {}])(
    'asks for nothing when the host does not offer the configured mode (%o)',
    async (hostContext) => {
      frame = createBridgeFrame({ beforeBridge: setDisplayMode('fullscreen') });
      await frame.settle();
      await frame.answer('ui/initialize', { hostCapabilities: {}, hostContext });

      expect(frame.requests('ui/request-display-mode')).toEqual([]);
    },
  );

  it('keeps the mode the host set, not the one it asked for', async () => {
    frame = createBridgeFrame({ beforeBridge: setDisplayMode('fullscreen') });
    await frame.settle();
    await frame.answer('ui/initialize', {
      hostCapabilities: {},
      hostContext: { displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen', 'pip'] },
    });

    await frame.answer('ui/request-display-mode', { mode: 'pip' });

    expect(frame.bridge.getHostContext()['displayMode']).toBe('pip');
  });

  it('asks for nothing when the tool leaves the widget inline', async () => {
    frame = createBridgeFrame({ beforeBridge: setDisplayMode('inline') });
    await frame.settle();
    await frame.answer('ui/initialize', { hostCapabilities: {}, hostContext: {} });

    expect(frame.requests('ui/request-display-mode')).toEqual([]);
  });

  it('asks the OpenAI Apps SDK for the configured mode', async () => {
    const requestDisplayMode = jest.fn().mockResolvedValue({ mode: 'pip' });
    frame = createBridgeFrame({
      beforeBridge: (win) => {
        setDisplayMode('pip')(win);
        (win as unknown as { openai: unknown }).openai = { callTool: () => Promise.resolve({}), requestDisplayMode };
      },
    });
    await frame.settle();

    expect(requestDisplayMode).toHaveBeenCalledWith({ mode: 'pip' });
  });
});

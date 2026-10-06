/**
 * @jest-environment jsdom
 */
/**
 * `ui.displayMode` reaches the page as `window.__mcpDisplayMode`, and the bridge asks the host for
 * it once it connects: `ui/request-display-mode` in an MCP Apps host, and
 * `window.openai.requestDisplayMode({ mode })` under the OpenAI Apps SDK.
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

  it('asks an MCP Apps host for the configured mode once the handshake completes', async () => {
    frame = createBridgeFrame({ beforeBridge: setDisplayMode('fullscreen') });
    await frame.settle();
    expect(frame.requests('ui/request-display-mode')).toEqual([]);

    await frame.answer('ui/initialize', { hostCapabilities: {}, hostContext: {} });

    expect(frame.requests('ui/request-display-mode').map((request) => request.params)).toEqual([
      { mode: 'fullscreen' },
    ]);
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

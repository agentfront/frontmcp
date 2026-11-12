/**
 * @jest-environment jsdom
 */
/**
 * The MCP Apps adapter of the bridge listens to its parent frame only. Another window that holds a
 * reference to the widget (a sibling frame, a frame inside the widget) can post to it, but its
 * messages neither pin their origin as the host's nor change what the widget shows.
 */
import { createBridgeFrame, type BridgeFrame } from './bridge-frame';

describe('bridge messages from a window other than the host frame', () => {
  let frame: BridgeFrame | undefined;
  let sibling: HTMLIFrameElement | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
    sibling?.remove();
    sibling = undefined;
  });

  function postFromSibling(win: BridgeFrame['win'], data: Record<string, unknown>): void {
    sibling = document.createElement('iframe');
    document.body.appendChild(sibling);
    win.dispatchEvent(
      new win.MessageEvent('message', { data, origin: 'https://other.example', source: sibling.contentWindow }),
    );
  }

  it.each([
    ['minified', true],
    ['unminified', false],
  ])('are ignored before and after the handshake (%s)', async (_label, minify) => {
    frame = createBridgeFrame({ minify });
    await frame.settle();

    postFromSibling(frame.win, {
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { structuredContent: { injected: true } },
    });
    await frame.settle();
    await frame.answer('ui/initialize', { hostCapabilities: {}, hostContext: {} });
    await frame.notify('ui/notifications/tool-result', { structuredContent: { temp: 18 } });

    expect(frame.bridge.getToolOutput()).toEqual({ temp: 18 });
    expect(frame.notifications('ui/notifications/initialized')).toHaveLength(1);
  });
});

/**
 * @jest-environment jsdom
 */
/**
 * What the widget reads as the tool output (#645).
 *
 * An MCP Apps host sends `ui/notifications/tool-result` with a CallToolResult
 * (`{ content: [...], structuredContent }`); the bridge must expose the
 * structured value, not the raw content array. The OpenAI Apps SDK provides the
 * data as `window.openai.toolOutput`, which a static widget must read.
 */
import { renderToolTemplate } from '../../adapters/template-renderer';
import { createBridgeFrame, type BridgeFrame, type FrameWindow } from './bridge-frame';

describe.each([
  ['minified', true],
  ['unminified', false],
])('bridge tool output (%s)', (_label, minify) => {
  let frame: BridgeFrame | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
  });

  async function openMcpApps(): Promise<BridgeFrame> {
    frame = createBridgeFrame({ minify, bodyHtml: '<div id="root"></div>' });
    await frame.settle();
    await frame.answer('ui/initialize', { hostCapabilities: {}, hostContext: {} });
    return frame;
  }

  it('exposes structuredContent from a tool-result notification', async () => {
    const f = await openMcpApps();
    const listener = jest.fn();
    f.bridge.onToolResult(listener);

    await f.notify('ui/notifications/tool-result', {
      content: [{ type: 'text', text: '{"temp":18}' }],
      structuredContent: { temp: 18 },
    });

    expect(f.bridge.getToolOutput()).toEqual({ temp: 18 });
    expect(f.bridge.getStructuredContent()).toEqual({ temp: 18 });
    expect(listener).toHaveBeenCalledWith({ temp: 18 });
  });

  it('parses JSON text content when there is no structuredContent', async () => {
    const f = await openMcpApps();
    await f.notify('ui/notifications/tool-result', { content: [{ type: 'text', text: '{"temp":21}' }] });
    expect(f.bridge.getToolOutput()).toEqual({ temp: 21 });
  });

  it('keeps plain text content as a string', async () => {
    const f = await openMcpApps();
    await f.notify('ui/notifications/tool-result', { content: [{ type: 'text', text: 'hello' }] });
    expect(f.bridge.getToolOutput()).toBe('hello');
  });

  it('falls back to the content array when it has no text item', async () => {
    const f = await openMcpApps();
    const content = [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }];
    await f.notify('ui/notifications/tool-result', { content });
    expect(f.bridge.getToolOutput()).toEqual(content);
  });

  it('reads window.openai.toolOutput and toolInput when the widget loads', async () => {
    frame = createBridgeFrame({
      minify,
      bodyHtml: '<div id="root"></div>',
      beforeBridge: (win: FrameWindow) => {
        (win as unknown as { openai: unknown }).openai = {
          callTool: () => Promise.resolve({}),
          toolInput: { city: 'Paris' },
          toolOutput: { temp: 18 },
        };
      },
    });
    await frame.settle();

    expect(frame.bridge.getToolOutput()).toEqual({ temp: 18 });
    expect(frame.bridge.getStructuredContent()).toEqual({ temp: 18 });
  });

  it('reads window.openai.toolOutput in a page compiled without a call (#681)', async () => {
    // What the server compiles at startup for `ui://widget/{tool}.html`: no call's data
    const page = renderToolTemplate({ toolName: 'weather', input: undefined, output: undefined, template: '<p></p>' });
    const dataScript = /<script>\n(window\.__mcpAppsEnabled[\s\S]*?)\n<\/script>/.exec(page.html)?.[1];
    expect(dataScript).toContain('window.__mcpToolOutput = null');

    frame = createBridgeFrame({
      minify,
      bodyHtml: '<div id="root"></div>',
      beforeBridge: (win: FrameWindow) => {
        win.eval(dataScript ?? '');
        (win as unknown as { openai: unknown }).openai = {
          callTool: () => Promise.resolve({}),
          toolInput: { city: 'Paris' },
          toolOutput: { temp: 18 },
        };
      },
    });
    await frame.settle();

    expect(frame.bridge.getToolOutput()).toEqual({ temp: 18 });
    expect((frame.bridge as unknown as { getToolInput(): unknown }).getToolInput()).toEqual({ city: 'Paris' });
  });

  it('propagates a changed toolInput from openai:set_globals', async () => {
    frame = createBridgeFrame({
      minify,
      bodyHtml: '<div id="root"></div>',
      beforeBridge: (win: FrameWindow) => {
        (win as unknown as { openai: unknown }).openai = {
          callTool: () => Promise.resolve({}),
          toolInput: { city: 'Paris' },
          toolOutput: { temp: 18 },
        };
      },
    });
    await frame.settle();
    const received: unknown[] = [];
    frame.win.addEventListener('tool:input', (e) => received.push((e as CustomEvent).detail.arguments));

    frame.win.dispatchEvent(
      new frame.win.CustomEvent('openai:set_globals', { detail: { globals: { toolInput: { city: 'Rome' } } } }),
    );

    expect((frame.bridge as unknown as { getToolInput(): unknown }).getToolInput()).toEqual({ city: 'Rome' });
    expect(received).toEqual([{ city: 'Rome' }]);
  });
});

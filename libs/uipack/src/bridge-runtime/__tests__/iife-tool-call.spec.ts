/**
 * @jest-environment jsdom
 */
/**
 * A widget's `tools/call` through an MCP Apps host carries `_meta['frontmcp/widgetCall']`, so a
 * FrontMCP server answers it with the tool's data and not a new page for a widget already on screen.
 */
import { WIDGET_CALL_META_KEY } from '../iife-generator';
import { createBridgeFrame, type BridgeFrame } from './bridge-frame';

describe('bridge tool calls through an MCP Apps host', () => {
  let frame: BridgeFrame | undefined;

  afterEach(() => {
    frame?.destroy();
    frame = undefined;
  });

  it('marks the tools/call as the widget own', async () => {
    frame = createBridgeFrame({ bodyHtml: '<div id="root"></div>' });
    await frame.settle();
    await frame.answer('ui/initialize', { hostCapabilities: { serverTools: {} }, hostContext: {} });

    void frame.bridge.callTool('close_ticket', { id: 'T-1' });
    await frame.settle();

    expect(frame.requests('tools/call').map((request) => request.params)).toEqual([
      { name: 'close_ticket', arguments: { id: 'T-1' }, _meta: { [WIDGET_CALL_META_KEY]: true } },
    ]);
  });
});

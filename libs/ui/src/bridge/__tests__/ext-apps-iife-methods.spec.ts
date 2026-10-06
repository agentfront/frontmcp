/**
 * The ext-apps adapter in `@frontmcp/ui`'s own bridge IIFE sends the MCP Apps spec methods, as the
 * `@frontmcp/uipack` bridge does: `tools/call` (marked as the widget's own call), `ui/open-link`
 * and `ui/request-display-mode`.
 */
import { generateBridgeIIFE } from '../runtime/iife-generator';

describe('@frontmcp/ui bridge IIFE ext-apps methods', () => {
  const script = generateBridgeIIFE({ adapters: ['ext-apps'] });

  it('calls server tools with tools/call, marked as the widget own call', () => {
    expect(script).toContain(
      "this.sendRequest('tools/call', { name: name, arguments: args || {}, _meta: { 'frontmcp/widgetCall': true } })",
    );
    expect(script).toContain('this.hostCapabilities.serverTools');
  });

  it('opens links with ui/open-link and asks for a display mode with ui/request-display-mode', () => {
    expect(script).toContain("this.sendRequest('ui/open-link', { url: url })");
    expect(script).toContain("this.sendRequest('ui/request-display-mode', { mode: mode })");
    expect(script).toContain('this.hostCapabilities.openLinks');
  });

  it('sends none of the earlier method names', () => {
    expect(script).not.toContain('ui/callServerTool');
    expect(script).not.toContain('ui/openLink');
    expect(script).not.toContain('ui/setDisplayMode');
  });
});

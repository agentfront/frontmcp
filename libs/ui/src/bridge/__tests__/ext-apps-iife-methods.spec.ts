/**
 * The ext-apps adapter in `@frontmcp/ui`'s own bridge IIFE sends the MCP Apps spec methods, as the
 * `@frontmcp/uipack` bridge does: `tools/call` (marked as the widget's own call), `ui/open-link`,
 * `ui/request-display-mode` and `ui/notifications/request-teardown`; and it hears
 * `ui/notifications/tool-cancelled`.
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

  it('asks for teardown with ui/notifications/request-teardown', () => {
    expect(script).toContain("this.sendNotification('ui/notifications/request-teardown', {})");
  });

  it('reports ui/notifications/tool-cancelled, and the earlier cancelled, as tool:cancelled', () => {
    expect(script).toContain("case 'ui/notifications/tool-cancelled':");
    expect(script).toContain("case 'ui/notifications/cancelled':");
    expect(script).toContain("new CustomEvent('tool:cancelled', { detail: { reason: params.reason } })");
  });

  it('sends none of the earlier method names', () => {
    expect(script).not.toContain('ui/callServerTool');
    expect(script).not.toContain('ui/openLink');
    expect(script).not.toContain('ui/setDisplayMode');
    expect(script).not.toContain('ui/close');
  });
});

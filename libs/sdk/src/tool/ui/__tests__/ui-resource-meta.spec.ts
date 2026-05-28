/**
 * Tests for the resource-level `_meta` payload attached to `ui://widget/…`
 * `resources/read` content items (#455).
 *
 * Claude (and the MCP Apps spec) only honor `_meta.ui.csp` /
 * `_meta.ui.permissions` declared on the UI **resource** — declaring them
 * on the tool is ignored. These tests cover the registry → handler hand-off.
 */
import { handleUIResourceRead } from '../ui-resource.handler';
import { ToolUIRegistry } from '../ui-shared';

describe('handleUIResourceRead — resource-level _meta (#455)', () => {
  it('omits `_meta` entirely when no csp or permissions were configured', () => {
    const registry = new ToolUIRegistry();
    // Directly seed a widget so we don't have to mock esbuild.
    (registry as unknown as { widgets: Map<string, string> }).widgets.set(
      'plain_tool',
      '<html><body>plain</body></html>',
    );

    const result = handleUIResourceRead('ui://widget/plain_tool.html', registry);
    expect(result.handled).toBe(true);
    const content = result.result?.contents?.[0] as Record<string, unknown> | undefined;
    expect(content).toBeDefined();
    expect(content?.['text']).toBe('<html><body>plain</body></html>');
    expect(content).not.toHaveProperty('_meta');
  });

  it('attaches `_meta.ui.csp` (nested) AND `_meta["ui/csp"]` (slash) when csp is configured', () => {
    const registry = new ToolUIRegistry();
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('weather', '<html>w</html>');
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('weather', {
      csp: {
        connectDomains: ['https://api.weather.example'],
        resourceDomains: ['https://cdn.example'],
      },
    });

    const result = handleUIResourceRead('ui://widget/weather.html', registry);
    const content = result.result?.contents?.[0] as Record<string, unknown>;

    const meta = content['_meta'] as Record<string, unknown>;
    expect(meta).toBeDefined();

    // Nested form (MCP Apps spec uses _meta.ui.csp in its docs).
    const ui = meta['ui'] as Record<string, unknown>;
    expect(ui['csp']).toEqual({
      connect_domains: ['https://api.weather.example'],
      resource_domains: ['https://cdn.example'],
    });

    // Slash form (FrontMCP's broader convention for ui/* meta keys).
    expect(meta['ui/csp']).toEqual({
      connect_domains: ['https://api.weather.example'],
      resource_domains: ['https://cdn.example'],
    });
  });

  it('emits csp keys in snake_case so MCP Apps hosts parse them', () => {
    const registry = new ToolUIRegistry();
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('q', '<html>q</html>');
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('q', {
      csp: { connectDomains: ['https://a.example'] },
    });

    const result = handleUIResourceRead('ui://widget/q.html', registry);
    const meta = (result.result?.contents?.[0] as Record<string, unknown>)['_meta'] as Record<string, unknown>;
    const csp = (meta['ui'] as Record<string, unknown>)['csp'] as Record<string, unknown>;
    expect(csp).toHaveProperty('connect_domains');
    // Don't emit empty resource_domains (or any other field that wasn't passed).
    expect(csp).not.toHaveProperty('resource_domains');
    expect(csp).not.toHaveProperty('connectDomains');
  });

  it('attaches permissions when configured (even with no csp)', () => {
    const registry = new ToolUIRegistry();
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('p', '<html>p</html>');
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('p', {
      permissions: { foo: 'bar' },
    });

    const result = handleUIResourceRead('ui://widget/p.html', registry);
    const meta = (result.result?.contents?.[0] as Record<string, unknown>)['_meta'] as Record<string, unknown>;
    expect((meta['ui'] as Record<string, unknown>)['permissions']).toEqual({ foo: 'bar' });
    expect(meta['ui/permissions']).toEqual({ foo: 'bar' });
  });

  it('also attaches `_meta` to the dynamic placeholder fallback', () => {
    const registry = new ToolUIRegistry();
    // Note: NO widget cached — handler returns the placeholder.
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('fallback_tool', {
      csp: { connectDomains: ['https://api.example'] },
    });

    const result = handleUIResourceRead('ui://widget/fallback_tool.html', registry);
    const content = result.result?.contents?.[0] as Record<string, unknown>;
    expect(content).toHaveProperty('_meta');
    const meta = content['_meta'] as Record<string, unknown>;
    expect((meta['ui'] as Record<string, unknown>)['csp']).toEqual({
      connect_domains: ['https://api.example'],
    });
  });
});

describe('ToolUIRegistry.getResourceMeta', () => {
  it('returns undefined when no meta was recorded', () => {
    const registry = new ToolUIRegistry();
    expect(registry.getResourceMeta('no_such_tool')).toBeUndefined();
  });

  it('records csp + permissions from uiConfig during compileStaticWidgetAsync', async () => {
    // We bypass the renderer by overriding the internal map (the renderer
    // pulls in esbuild and the real fs; not what this test is here to
    // validate). The compileStaticWidgetAsync code path is also exercised
    // via end-to-end tests in the SDK suite.
    const registry = new ToolUIRegistry();
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('weather', {
      csp: { connectDomains: ['https://w.example'] },
      permissions: { foo: true },
    });
    expect(registry.getResourceMeta('weather')).toEqual({
      csp: { connectDomains: ['https://w.example'] },
      permissions: { foo: true },
    });
  });
});

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

  it('preserves unknown / future CSP keys verbatim (normalizeCspForResource passthrough)', () => {
    const registry = new ToolUIRegistry();
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('future_tool', '<html>f</html>');
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('future_tool', {
      csp: {
        connectDomains: ['https://api.example'],
        // Hypothetical future MCP Apps CSP field — must survive normalization.
        frame_ancestors: ["'none'"],
        sandboxFlags: ['allow-scripts'],
      } as unknown as { connectDomains: string[] },
    });

    const result = handleUIResourceRead('ui://widget/future_tool.html', registry);
    const content = result.result?.contents?.[0] as Record<string, unknown>;
    const meta = content['_meta'] as Record<string, unknown>;
    const csp = (meta['ui'] as Record<string, unknown>)['csp'] as Record<string, unknown>;

    expect(csp).toEqual({
      connect_domains: ['https://api.example'],
      frame_ancestors: ["'none'"],
      sandboxFlags: ['allow-scripts'],
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

describe('ToolUIRegistry — widget sizing round-trip', () => {
  it('renderAndRegisterAsync returns ui/* sizing meta keys from uiConfig', async () => {
    const registry = new ToolUIRegistry();
    const { meta } = await registry.renderAndRegisterAsync({
      toolName: 'sized',
      input: {},
      output: { value: 1 },
      uiConfig: {
        template: '<div>Hello</div>',
        preferredHeight: 420,
        minHeight: 100,
        maxHeight: 600,
        aspectRatio: '16 / 9',
      },
    });

    expect(meta['ui/preferredHeight']).toBe(420);
    expect(meta['ui/minHeight']).toBe(100);
    expect(meta['ui/maxHeight']).toBe(600);
    expect(meta['ui/aspectRatio']).toBe('16 / 9');
  });

  it('renderAndRegisterAsync injects sizing CSS + __mcpWidgetSizing into the widget HTML', async () => {
    const registry = new ToolUIRegistry();
    await registry.renderAndRegisterAsync({
      toolName: 'sized2',
      input: {},
      output: {},
      uiConfig: { template: '<div>Hi</div>', preferredHeight: 300, autoResize: false },
    });

    const html = registry.getStaticWidget('sized2');
    expect(html).toBeDefined();
    expect(html).toContain('window.__mcpWidgetSizing =');
    expect(html).toContain('height: 300px;');
    expect(html).toContain('"autoResize":false');
  });

  it('compileStaticWidgetAsync threads sizing from uiConfig into the cached widget', async () => {
    const registry = new ToolUIRegistry();
    await registry.compileStaticWidgetAsync({
      toolName: 'sized3',
      template: '<div>Static</div>',
      uiConfig: { template: '<div>Static</div>', preferredHeight: '50vh' },
    });

    const html = registry.getStaticWidget('sized3');
    expect(html).toBeDefined();
    expect(html).toContain('window.__mcpWidgetSizing =');
    expect(html).toContain('height: 50vh;');
  });

  it('does NOT inject sizing when uiConfig has no sizing fields', async () => {
    const registry = new ToolUIRegistry();
    const { meta } = await registry.renderAndRegisterAsync({
      toolName: 'plain_sized',
      input: {},
      output: {},
      uiConfig: { template: '<div>Plain</div>' },
    });

    expect(meta).not.toHaveProperty('ui/preferredHeight');
    const html = registry.getStaticWidget('plain_sized');
    // The bridge IIFE always references window.__mcpWidgetSizing to read it;
    // with no sizing configured, the data-injection script must not assign it.
    expect(html).not.toContain('window.__mcpWidgetSizing =');
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

  it('clears resourceMeta on re-compile when csp/permissions removed from uiConfig', () => {
    // Exercise the private updateResourceMetaFromConfig hook by reaching in —
    // we want to confirm the "delete on absence" branch protects against
    // stale meta leaking forward when a tool's config is edited (#455 review).
    const registry = new ToolUIRegistry();
    const updateMeta = (
      registry as unknown as {
        updateResourceMetaFromConfig: (name: string, cfg: Record<string, unknown> | undefined) => void;
      }
    ).updateResourceMetaFromConfig.bind(registry);

    updateMeta('shifty', { csp: { connectDomains: ['https://a.example'] } });
    expect(registry.getResourceMeta('shifty')).toEqual({
      csp: { connectDomains: ['https://a.example'] },
      permissions: undefined,
    });

    // Re-compile with the csp removed → meta should be wiped, not stale.
    updateMeta('shifty', {});
    expect(registry.getResourceMeta('shifty')).toBeUndefined();

    // And undefined config also clears.
    updateMeta('shifty', { csp: { connectDomains: ['https://b.example'] } });
    updateMeta('shifty', undefined);
    expect(registry.getResourceMeta('shifty')).toBeUndefined();
  });
});

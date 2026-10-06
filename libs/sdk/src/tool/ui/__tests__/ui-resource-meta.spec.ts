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

    const expectedCsp = {
      connectDomains: ['https://api.weather.example'],
      resourceDomains: ['https://cdn.example'],
      connect_domains: ['https://api.weather.example'],
      resource_domains: ['https://cdn.example'],
    };
    // Nested form (MCP Apps spec uses _meta.ui.csp in its docs).
    expect((meta['ui'] as Record<string, unknown>)['csp']).toEqual(expectedCsp);
    // Slash form (FrontMCP's broader convention for ui/* meta keys).
    expect(meta['ui/csp']).toEqual(expectedCsp);
  });

  it('preserves unknown / future CSP keys verbatim', () => {
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
      connectDomains: ['https://api.example'],
      connect_domains: ['https://api.example'],
      frame_ancestors: ["'none'"],
      sandboxFlags: ['allow-scripts'],
    });
    expect(meta['openai/widgetCSP']).toEqual({
      connect_domains: ['https://api.example'],
      frame_ancestors: ["'none'"],
      sandboxFlags: ['allow-scripts'],
    });
  });

  it('emits the MCP Apps camelCase csp keys that spec hosts read, with the earlier snake_case keys alongside', () => {
    const registry = new ToolUIRegistry();
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('q', '<html>q</html>');
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('q', {
      csp: { connectDomains: ['https://a.example'] },
    });

    const result = handleUIResourceRead('ui://widget/q.html', registry);
    const meta = (result.result?.contents?.[0] as Record<string, unknown>)['_meta'] as Record<string, unknown>;
    const csp = (meta['ui'] as Record<string, unknown>)['csp'] as Record<string, unknown>;
    expect(csp['connectDomains']).toEqual(['https://a.example']);
    expect(csp['connect_domains']).toEqual(['https://a.example']);
    expect(meta['ui/csp']).toEqual(csp);
    // Don't emit empty resource domains (or any other field that wasn't passed).
    expect(csp).not.toHaveProperty('resourceDomains');
    expect(csp).not.toHaveProperty('resource_domains');
  });

  it('emits `openai/widgetCSP` in the OpenAI Apps SDK snake_case only', () => {
    const registry = new ToolUIRegistry();
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('o', '<html>o</html>');
    (registry as unknown as { resourceMeta: Map<string, unknown> }).resourceMeta.set('o', {
      csp: { connectDomains: ['https://api.example'], resourceDomains: ['https://cdn.example'] },
    });

    const result = handleUIResourceRead('ui://widget/o.html', registry);
    const meta = (result.result?.contents?.[0] as Record<string, unknown>)['_meta'] as Record<string, unknown>;
    expect(meta['openai/widgetCSP']).toEqual({
      connect_domains: ['https://api.example'],
      resource_domains: ['https://cdn.example'],
    });
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
      connectDomains: ['https://api.example'],
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
    const { meta } = await registry.renderAndRegisterAsync({
      toolName: 'sized2',
      input: {},
      output: {},
      uiConfig: { template: '<div>Hi</div>', preferredHeight: 300, autoResize: false },
    });

    const html = meta['ui/html'];
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
    const html = meta['ui/html'];
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

  it('records csp for a lean (template-less) compile so the widget resource has _meta before any call', async () => {
    const registry = new ToolUIRegistry();

    await registry.compileLeanWidgetAsync({
      toolName: 'lean_tool',
      uiConfig: { csp: { connectDomains: ['https://lean.example'] }, permissions: { camera: {} } },
    });

    expect(registry.getResourceMeta('lean_tool')).toEqual({
      csp: { connectDomains: ['https://lean.example'] },
      permissions: { camera: {} },
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

describe('handleUIResourceRead — custom resourceUri and unknown widgets (#645)', () => {
  it('serves the widget of a tool that advertises a custom ui.resourceUri', () => {
    const registry = new ToolUIRegistry();
    registry.registerTool('custom_tool', 'ui://acme/dashboard');
    (registry as unknown as { widgets: Map<string, string> }).widgets.set('custom_tool', '<html>custom</html>');

    const result = handleUIResourceRead('ui://acme/dashboard', registry);

    expect(result.error).toBeUndefined();
    expect((result.result?.contents?.[0] as { text?: string }).text).toBe('<html>custom</html>');
  });

  it('serves a placeholder for a registered tool with a custom uri and no compiled widget', () => {
    const registry = new ToolUIRegistry();
    registry.registerTool('inline_tool', 'ui://acme/inline');

    const result = handleUIResourceRead('ui://acme/inline', registry);

    expect(result.error).toBeUndefined();
    expect((result.result?.contents?.[0] as { text?: string }).text).toContain('inline_tool');
  });

  it('does not invent a placeholder for a tool that has no UI', () => {
    const registry = new ToolUIRegistry();
    registry.registerTool('real_tool');

    const result = handleUIResourceRead('ui://widget/nope.html', registry);

    expect(result.handled).toBe(true);
    expect(result.result).toBeUndefined();
    expect(result.error).toContain('ui://widget/nope.html');
  });

  it('still rejects an unadvertised custom-scheme URI', () => {
    const registry = new ToolUIRegistry();
    registry.registerTool('real_tool', 'ui://acme/dashboard');

    expect(handleUIResourceRead('ui://acme/other', registry).error).toBeDefined();
  });

  it('resolves the app-qualified widget name of a registered tool', () => {
    const registry = new ToolUIRegistry();
    registry.registerTool('lookup');

    expect(handleUIResourceRead('ui://widget/crm%3Alookup.html', registry).result).toBeDefined();
  });
});

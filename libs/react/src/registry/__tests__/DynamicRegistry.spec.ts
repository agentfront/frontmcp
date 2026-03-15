import type { CallToolResult, ReadResourceResult } from '@frontmcp/sdk';
import type { DynamicToolDef, DynamicResourceDef } from '../../types';
import { DynamicRegistry } from '../DynamicRegistry';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createToolDef(overrides: Partial<DynamicToolDef> = {}): DynamicToolDef {
  return {
    name: overrides.name ?? 'test-tool',
    description: overrides.description ?? 'A test tool',
    inputSchema: overrides.inputSchema ?? { type: 'object', properties: {} },
    execute: overrides.execute ?? jest.fn().mockResolvedValue({ content: [] } as CallToolResult),
  };
}

function createResourceDef(overrides: Partial<DynamicResourceDef> = {}): DynamicResourceDef {
  return {
    uri: overrides.uri ?? 'test://resource',
    name: overrides.name ?? 'test-resource',
    description: overrides.description ?? 'A test resource',
    mimeType: overrides.mimeType ?? 'text/plain',
    read: overrides.read ?? jest.fn().mockResolvedValue({ contents: [] } as ReadResourceResult),
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('DynamicRegistry', () => {
  let registry: DynamicRegistry;

  beforeEach(() => {
    registry = new DynamicRegistry();
  });

  // ─── registerTool ───────────────────────────────────────────────────────

  describe('registerTool', () => {
    it('adds the tool to the registry', () => {
      const tool = createToolDef({ name: 'my-tool' });
      registry.registerTool(tool);

      expect(registry.hasTool('my-tool')).toBe(true);
      expect(registry.findTool('my-tool')).toBe(tool);
    });

    it('returns a cleanup function that unregisters the tool', () => {
      const tool = createToolDef({ name: 'my-tool' });
      const cleanup = registry.registerTool(tool);

      expect(registry.hasTool('my-tool')).toBe(true);
      cleanup();
      expect(registry.hasTool('my-tool')).toBe(false);
    });

    it('notifies listeners on registration', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.registerTool(createToolDef());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('increments version on registration', () => {
      expect(registry.getVersion()).toBe(0);
      registry.registerTool(createToolDef());
      expect(registry.getVersion()).toBe(1);
    });

    it('overwrites an existing tool definition with the same name', () => {
      const tool1 = createToolDef({ name: 'dup', description: 'first' });
      const tool2 = createToolDef({ name: 'dup', description: 'second' });

      registry.registerTool(tool1);
      registry.registerTool(tool2);

      expect(registry.findTool('dup')?.description).toBe('second');
      expect(registry.getTools()).toHaveLength(1);
    });

    it('only notifies on first registration of a name (ref counting)', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.registerTool(createToolDef({ name: 'rc' }));
      expect(listener).toHaveBeenCalledTimes(1);

      // Second registration of the same name should NOT notify
      registry.registerTool(createToolDef({ name: 'rc', description: 'updated' }));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ─── unregisterTool ─────────────────────────────────────────────────────

  describe('unregisterTool', () => {
    it('removes an existing tool and notifies', () => {
      registry.registerTool(createToolDef({ name: 'rm-tool' }));
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.unregisterTool('rm-tool');

      expect(registry.hasTool('rm-tool')).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not notify when tool does not exist', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.unregisterTool('nonexistent');
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not increment version when tool does not exist', () => {
      const v = registry.getVersion();
      registry.unregisterTool('nonexistent');
      expect(registry.getVersion()).toBe(v);
    });

    it('ref counting: register twice, unregister once → tool still exists', () => {
      registry.registerTool(createToolDef({ name: 'rc-tool', description: 'v1' }));
      registry.registerTool(createToolDef({ name: 'rc-tool', description: 'v2' }));

      registry.unregisterTool('rc-tool');

      expect(registry.hasTool('rc-tool')).toBe(true);
      expect(registry.findTool('rc-tool')?.description).toBe('v2');
    });

    it('ref counting: register twice, unregister twice → tool removed', () => {
      registry.registerTool(createToolDef({ name: 'rc-tool' }));
      registry.registerTool(createToolDef({ name: 'rc-tool' }));

      registry.unregisterTool('rc-tool');
      registry.unregisterTool('rc-tool');

      expect(registry.hasTool('rc-tool')).toBe(false);
    });

    it('ref counting: does not notify on intermediate unregister', () => {
      registry.registerTool(createToolDef({ name: 'rc-tool' }));
      registry.registerTool(createToolDef({ name: 'rc-tool' }));

      const listener = jest.fn();
      registry.subscribe(listener);

      registry.unregisterTool('rc-tool'); // decrement to 1, no notify
      expect(listener).not.toHaveBeenCalled();

      registry.unregisterTool('rc-tool'); // decrement to 0, notify
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ─── registerResource ──────────────────────────────────────────────────

  describe('registerResource', () => {
    it('adds the resource to the registry', () => {
      const res = createResourceDef({ uri: 'file://a' });
      registry.registerResource(res);

      expect(registry.hasResource('file://a')).toBe(true);
      expect(registry.findResource('file://a')).toBe(res);
    });

    it('returns a cleanup function that unregisters the resource', () => {
      const res = createResourceDef({ uri: 'file://b' });
      const cleanup = registry.registerResource(res);

      expect(registry.hasResource('file://b')).toBe(true);
      cleanup();
      expect(registry.hasResource('file://b')).toBe(false);
    });

    it('notifies listeners on registration', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.registerResource(createResourceDef());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('increments version on registration', () => {
      expect(registry.getVersion()).toBe(0);
      registry.registerResource(createResourceDef());
      expect(registry.getVersion()).toBe(1);
    });

    it('overwrites an existing resource definition with the same URI', () => {
      const res1 = createResourceDef({ uri: 'dup://x', name: 'first' });
      const res2 = createResourceDef({ uri: 'dup://x', name: 'second' });

      registry.registerResource(res1);
      registry.registerResource(res2);

      expect(registry.findResource('dup://x')?.name).toBe('second');
      expect(registry.getResources()).toHaveLength(1);
    });

    it('only notifies on first registration of a URI (ref counting)', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.registerResource(createResourceDef({ uri: 'rc://r' }));
      expect(listener).toHaveBeenCalledTimes(1);

      registry.registerResource(createResourceDef({ uri: 'rc://r', name: 'updated' }));
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ─── unregisterResource ────────────────────────────────────────────────

  describe('unregisterResource', () => {
    it('removes an existing resource and notifies', () => {
      registry.registerResource(createResourceDef({ uri: 'rm://res' }));
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.unregisterResource('rm://res');

      expect(registry.hasResource('rm://res')).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('does not notify when resource does not exist', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.unregisterResource('nonexistent://uri');
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not increment version when resource does not exist', () => {
      const v = registry.getVersion();
      registry.unregisterResource('nonexistent://uri');
      expect(registry.getVersion()).toBe(v);
    });

    it('ref counting: register twice, unregister once → resource still exists', () => {
      registry.registerResource(createResourceDef({ uri: 'rc://r', name: 'v1' }));
      registry.registerResource(createResourceDef({ uri: 'rc://r', name: 'v2' }));

      registry.unregisterResource('rc://r');

      expect(registry.hasResource('rc://r')).toBe(true);
      expect(registry.findResource('rc://r')?.name).toBe('v2');
    });

    it('ref counting: register twice, unregister twice → resource removed', () => {
      registry.registerResource(createResourceDef({ uri: 'rc://r' }));
      registry.registerResource(createResourceDef({ uri: 'rc://r' }));

      registry.unregisterResource('rc://r');
      registry.unregisterResource('rc://r');

      expect(registry.hasResource('rc://r')).toBe(false);
    });

    it('ref counting: does not notify on intermediate unregister', () => {
      registry.registerResource(createResourceDef({ uri: 'rc://r' }));
      registry.registerResource(createResourceDef({ uri: 'rc://r' }));

      const listener = jest.fn();
      registry.subscribe(listener);

      registry.unregisterResource('rc://r');
      expect(listener).not.toHaveBeenCalled();

      registry.unregisterResource('rc://r');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ─── updateToolExecute ─────────────────────────────────────────────────

  describe('updateToolExecute', () => {
    it('updates the execute function of an existing tool', () => {
      const originalExecute = jest.fn();
      registry.registerTool(createToolDef({ name: 'upd', execute: originalExecute }));

      const newExecute = jest.fn();
      registry.updateToolExecute('upd', newExecute);

      expect(registry.findTool('upd')?.execute).toBe(newExecute);
    });

    it('is a no-op when tool does not exist', () => {
      const newExecute = jest.fn();
      expect(() => registry.updateToolExecute('missing', newExecute)).not.toThrow();
    });

    it('does not notify or increment version (silent update)', () => {
      registry.registerTool(createToolDef({ name: 'silent' }));
      const listener = jest.fn();
      registry.subscribe(listener);
      const v = registry.getVersion();

      registry.updateToolExecute('silent', jest.fn());

      expect(listener).not.toHaveBeenCalled();
      expect(registry.getVersion()).toBe(v);
    });
  });

  // ─── updateResourceRead ────────────────────────────────────────────────

  describe('updateResourceRead', () => {
    it('updates the read function of an existing resource', () => {
      const originalRead = jest.fn();
      registry.registerResource(createResourceDef({ uri: 'upd://r', read: originalRead }));

      const newRead = jest.fn();
      registry.updateResourceRead('upd://r', newRead);

      expect(registry.findResource('upd://r')?.read).toBe(newRead);
    });

    it('is a no-op when resource does not exist', () => {
      const newRead = jest.fn();
      expect(() => registry.updateResourceRead('missing://r', newRead)).not.toThrow();
    });

    it('does not notify or increment version (silent update)', () => {
      registry.registerResource(createResourceDef({ uri: 'silent://r' }));
      const listener = jest.fn();
      registry.subscribe(listener);
      const v = registry.getVersion();

      registry.updateResourceRead('silent://r', jest.fn());

      expect(listener).not.toHaveBeenCalled();
      expect(registry.getVersion()).toBe(v);
    });
  });

  // ─── getTools / getResources ───────────────────────────────────────────

  describe('getTools', () => {
    it('returns empty array when no tools registered', () => {
      expect(registry.getTools()).toEqual([]);
    });

    it('returns all registered tools', () => {
      registry.registerTool(createToolDef({ name: 'a' }));
      registry.registerTool(createToolDef({ name: 'b' }));

      const tools = registry.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    });

    it('returns a copy (not the internal collection)', () => {
      registry.registerTool(createToolDef({ name: 'x' }));
      const tools1 = registry.getTools();
      const tools2 = registry.getTools();
      expect(tools1).not.toBe(tools2);
      expect(tools1).toEqual(tools2);
    });
  });

  describe('getResources', () => {
    it('returns empty array when no resources registered', () => {
      expect(registry.getResources()).toEqual([]);
    });

    it('returns all registered resources', () => {
      registry.registerResource(createResourceDef({ uri: 'a://1' }));
      registry.registerResource(createResourceDef({ uri: 'b://2' }));

      const resources = registry.getResources();
      expect(resources).toHaveLength(2);
      expect(resources.map((r) => r.uri)).toEqual(['a://1', 'b://2']);
    });

    it('returns a copy (not the internal collection)', () => {
      registry.registerResource(createResourceDef({ uri: 'x://1' }));
      const res1 = registry.getResources();
      const res2 = registry.getResources();
      expect(res1).not.toBe(res2);
      expect(res1).toEqual(res2);
    });
  });

  // ─── findTool / findResource ───────────────────────────────────────────

  describe('findTool', () => {
    it('returns the tool when it exists', () => {
      const tool = createToolDef({ name: 'find-me' });
      registry.registerTool(tool);
      expect(registry.findTool('find-me')).toBe(tool);
    });

    it('returns undefined when tool does not exist', () => {
      expect(registry.findTool('nonexistent')).toBeUndefined();
    });
  });

  describe('findResource', () => {
    it('returns the resource when it exists', () => {
      const res = createResourceDef({ uri: 'find://me' });
      registry.registerResource(res);
      expect(registry.findResource('find://me')).toBe(res);
    });

    it('returns undefined when resource does not exist', () => {
      expect(registry.findResource('nonexistent://uri')).toBeUndefined();
    });
  });

  // ─── hasTool / hasResource ─────────────────────────────────────────────

  describe('hasTool', () => {
    it('returns true for a registered tool', () => {
      registry.registerTool(createToolDef({ name: 'exists' }));
      expect(registry.hasTool('exists')).toBe(true);
    });

    it('returns false for an unregistered tool', () => {
      expect(registry.hasTool('nope')).toBe(false);
    });

    it('returns false after tool is unregistered', () => {
      registry.registerTool(createToolDef({ name: 'temp' }));
      registry.unregisterTool('temp');
      expect(registry.hasTool('temp')).toBe(false);
    });
  });

  describe('hasResource', () => {
    it('returns true for a registered resource', () => {
      registry.registerResource(createResourceDef({ uri: 'has://yes' }));
      expect(registry.hasResource('has://yes')).toBe(true);
    });

    it('returns false for an unregistered resource', () => {
      expect(registry.hasResource('has://no')).toBe(false);
    });

    it('returns false after resource is unregistered', () => {
      registry.registerResource(createResourceDef({ uri: 'has://temp' }));
      registry.unregisterResource('has://temp');
      expect(registry.hasResource('has://temp')).toBe(false);
    });
  });

  // ─── subscribe ─────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('returns an unsubscribe function that removes the listener', () => {
      const listener = jest.fn();
      const unsub = registry.subscribe(listener);

      registry.registerTool(createToolDef({ name: 'sub-test' }));
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();
      registry.registerTool(createToolDef({ name: 'sub-test-2' }));
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });

    it('supports multiple listeners', () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      registry.subscribe(l1);
      registry.subscribe(l2);

      registry.registerTool(createToolDef());

      expect(l1).toHaveBeenCalledTimes(1);
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('unsubscribing one listener does not affect others', () => {
      const l1 = jest.fn();
      const l2 = jest.fn();
      const unsub1 = registry.subscribe(l1);
      registry.subscribe(l2);

      unsub1();
      registry.registerTool(createToolDef());

      expect(l1).not.toHaveBeenCalled();
      expect(l2).toHaveBeenCalledTimes(1);
    });

    it('listener is called for tool and resource mutations', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.registerTool(createToolDef({ name: 't1' })); // first reg → notify
      registry.registerResource(createResourceDef({ uri: 'r://1' })); // first reg → notify
      registry.unregisterTool('t1'); // last ref → notify
      registry.unregisterResource('r://1'); // last ref → notify

      expect(listener).toHaveBeenCalledTimes(4);
    });
  });

  // ─── getVersion ────────────────────────────────────────────────────────

  describe('getVersion', () => {
    it('starts at 0', () => {
      expect(registry.getVersion()).toBe(0);
    });

    it('increments on registerTool', () => {
      registry.registerTool(createToolDef());
      expect(registry.getVersion()).toBe(1);
    });

    it('increments on unregisterTool (when tool exists)', () => {
      registry.registerTool(createToolDef({ name: 'v-tool' }));
      registry.unregisterTool('v-tool');
      expect(registry.getVersion()).toBe(2);
    });

    it('does not increment on unregisterTool for missing tool', () => {
      registry.unregisterTool('nope');
      expect(registry.getVersion()).toBe(0);
    });

    it('increments on registerResource', () => {
      registry.registerResource(createResourceDef());
      expect(registry.getVersion()).toBe(1);
    });

    it('increments on unregisterResource (when resource exists)', () => {
      registry.registerResource(createResourceDef({ uri: 'v://r' }));
      registry.unregisterResource('v://r');
      expect(registry.getVersion()).toBe(2);
    });

    it('does not increment on unregisterResource for missing resource', () => {
      registry.unregisterResource('nope://x');
      expect(registry.getVersion()).toBe(0);
    });

    it('increments on clear', () => {
      registry.registerTool(createToolDef());
      registry.clear();
      expect(registry.getVersion()).toBe(2);
    });

    it('does not increment on updateToolExecute', () => {
      registry.registerTool(createToolDef({ name: 'ne' }));
      const v = registry.getVersion();
      registry.updateToolExecute('ne', jest.fn());
      expect(registry.getVersion()).toBe(v);
    });

    it('does not increment on updateResourceRead', () => {
      registry.registerResource(createResourceDef({ uri: 'ne://r' }));
      const v = registry.getVersion();
      registry.updateResourceRead('ne://r', jest.fn());
      expect(registry.getVersion()).toBe(v);
    });
  });

  // ─── clear ─────────────────────────────────────────────────────────────

  describe('clear', () => {
    it('removes all tools and resources', () => {
      registry.registerTool(createToolDef({ name: 'a' }));
      registry.registerTool(createToolDef({ name: 'b' }));
      registry.registerResource(createResourceDef({ uri: 'x://1' }));
      registry.registerResource(createResourceDef({ uri: 'y://2' }));

      registry.clear();

      expect(registry.getTools()).toEqual([]);
      expect(registry.getResources()).toEqual([]);
      expect(registry.hasTool('a')).toBe(false);
      expect(registry.hasResource('x://1')).toBe(false);
    });

    it('notifies listeners', () => {
      registry.registerTool(createToolDef());
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.clear();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('increments version', () => {
      registry.registerTool(createToolDef());
      const v = registry.getVersion();
      registry.clear();
      expect(registry.getVersion()).toBe(v + 1);
    });

    it('is safe to call on an empty registry', () => {
      const listener = jest.fn();
      registry.subscribe(listener);

      registry.clear();
      // Still notifies even when empty (no conditional guard)
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

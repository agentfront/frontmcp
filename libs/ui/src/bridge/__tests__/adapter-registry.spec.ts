/**
 * Adapter Registry Tests
 */

import { AdapterRegistry } from '../core/adapter-registry';
import type { PlatformAdapter, AdapterCapabilities, HostContext, DisplayMode } from '../types';

// Minimal mock adapter that doesn't need window
class MockAdapter implements PlatformAdapter {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly capabilities: AdapterCapabilities = {
    canCallTools: false,
    canSendMessages: false,
    canOpenLinks: false,
    canPersistState: true,
    hasNetworkAccess: true,
    supportsDisplayModes: false,
    supportsTheme: true,
  };
  private _shouldHandle: boolean;

  constructor(id: string, name: string, priority: number, shouldHandle = true) {
    this.id = id;
    this.name = name;
    this.priority = priority;
    this._shouldHandle = shouldHandle;
  }

  canHandle(): boolean {
    return this._shouldHandle;
  }

  async initialize(): Promise<void> {
    /* noop */
  }
  dispose(): void {
    /* noop */
  }
  getTheme(): 'light' | 'dark' {
    return 'light';
  }
  getDisplayMode(): DisplayMode {
    return 'inline';
  }
  getUserAgent() {
    return { type: 'web' as const, hover: true, touch: false };
  }
  getLocale(): string {
    return 'en-US';
  }
  getToolInput(): Record<string, unknown> {
    return {};
  }
  getToolOutput(): unknown {
    return undefined;
  }
  getStructuredContent(): unknown {
    return undefined;
  }
  getWidgetState(): Record<string, unknown> {
    return {};
  }
  getSafeArea() {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  getViewport() {
    return undefined;
  }
  getHostContext(): HostContext {
    return {
      theme: 'light',
      displayMode: 'inline',
      locale: 'en-US',
      userAgent: { type: 'web', hover: true, touch: false },
      safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
    };
  }
  async callTool(): Promise<unknown> {
    throw new Error('Not implemented');
  }
  async sendMessage(): Promise<void> {
    throw new Error('Not implemented');
  }
  async openLink(): Promise<void> {
    /* noop */
  }
  async requestDisplayMode(): Promise<void> {
    /* noop */
  }
  async requestClose(): Promise<void> {
    /* noop */
  }
  setWidgetState(): void {
    /* noop */
  }
  onContextChange(): () => void {
    return () => {
      /* noop */
    };
  }
  onToolResult(): () => void {
    return () => {
      /* noop */
    };
  }
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  describe('registration', () => {
    it('should register adapters', () => {
      const factory = () => new MockAdapter('test', 'Test', 50);
      registry.register('test', factory);

      expect(registry.has('test')).toBe(true);
      expect(registry.getRegisteredIds()).toContain('test');
    });

    it('should overwrite existing adapters on re-registration', () => {
      const factory1 = () => new MockAdapter('test', 'Test 1', 50);
      const factory2 = () => new MockAdapter('test', 'Test 2', 60);

      registry.register('test', factory1);
      registry.register('test', factory2);

      const adapter = registry.get('test');
      expect(adapter?.name).toBe('Test 2');
    });

    it('should unregister adapters', () => {
      const factory = () => new MockAdapter('test', 'Test', 50);
      registry.register('test', factory);

      expect(registry.unregister('test')).toBe(true);
      expect(registry.has('test')).toBe(false);
    });

    it('should return false when unregistering non-existent adapter', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('enable/disable', () => {
    it('should disable adapters', () => {
      const factory = () => new MockAdapter('test', 'Test', 50);
      registry.register('test', factory);

      registry.disable('test');
      expect(registry.isDisabled('test')).toBe(true);
      expect(registry.get('test')).toBeUndefined();
    });

    it('should enable previously disabled adapters', () => {
      const factory = () => new MockAdapter('test', 'Test', 50);
      registry.register('test', factory);

      registry.disable('test');
      registry.enable('test');

      expect(registry.isDisabled('test')).toBe(false);
      expect(registry.get('test')).toBeDefined();
    });

    it('should skip disabled adapters during detection', () => {
      registry.register('high', () => new MockAdapter('high', 'High', 100));
      registry.register('low', () => new MockAdapter('low', 'Low', 10));

      registry.disable('high');

      const detected = registry.detect();
      expect(detected?.id).toBe('low');
    });
  });

  describe('detection', () => {
    it('should detect adapters by priority (highest first)', () => {
      registry.register('low', () => new MockAdapter('low', 'Low', 10));
      registry.register('high', () => new MockAdapter('high', 'High', 100));
      registry.register('medium', () => new MockAdapter('medium', 'Medium', 50));

      const detected = registry.detect();
      expect(detected?.id).toBe('high');
    });

    it('should skip adapters that cannot handle the environment', () => {
      registry.register('high', () => new MockAdapter('high', 'High', 100, false));
      registry.register('low', () => new MockAdapter('low', 'Low', 10, true));

      const detected = registry.detect();
      expect(detected?.id).toBe('low');
    });

    it('should return undefined when no adapter can handle', () => {
      registry.register('test', () => new MockAdapter('test', 'Test', 50, false));

      const detected = registry.detect();
      expect(detected).toBeUndefined();
    });

    it('should detect all compatible adapters', () => {
      registry.register('a', () => new MockAdapter('a', 'A', 100, true));
      registry.register('b', () => new MockAdapter('b', 'B', 50, true));
      registry.register('c', () => new MockAdapter('c', 'C', 10, false));

      const all = registry.detectAll();
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe('a');
      expect(all[1].id).toBe('b');
    });
  });

  describe('configuration', () => {
    it('should apply adapter-specific configuration', () => {
      const factory = jest.fn(() => new MockAdapter('test', 'Test', 50));
      registry.register('test', factory);

      registry.configure('test', { priority: 100 });
      registry.get('test');

      expect(factory).toHaveBeenCalledWith(expect.objectContaining({ priority: 100 }));
    });

    it('should disable adapter via config', () => {
      registry.register('test', () => new MockAdapter('test', 'Test', 50));
      registry.configure('test', { enabled: false });

      expect(registry.get('test')).toBeUndefined();
    });
  });

  describe('clear', () => {
    it('should clear all adapters', () => {
      registry.register('a', () => new MockAdapter('a', 'A', 100));
      registry.register('b', () => new MockAdapter('b', 'B', 50));

      registry.clear();

      expect(registry.getRegisteredIds()).toHaveLength(0);
    });
  });
});

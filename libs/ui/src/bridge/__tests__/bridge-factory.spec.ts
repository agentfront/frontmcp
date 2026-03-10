/**
 * FrontMcpBridge Factory Tests
 */

import { FrontMcpBridge, createBridge, resetGlobalBridge } from '../core/bridge-factory';
import { AdapterRegistry } from '../core/adapter-registry';
import type { PlatformAdapter, AdapterCapabilities, HostContext, DisplayMode } from '../types';

// Minimal mock adapter that doesn't need window
class MockAdapter implements PlatformAdapter {
  readonly id = 'mock';
  readonly name = 'Mock Adapter';
  readonly priority = 100;
  readonly capabilities: AdapterCapabilities = {
    canCallTools: true,
    canSendMessages: true,
    canOpenLinks: false,
    canPersistState: true,
    hasNetworkAccess: true,
    supportsDisplayModes: false,
    supportsTheme: true,
  };
  public initializeCalled = false;
  public disposeCalled = false;

  canHandle(): boolean {
    return true;
  }

  async initialize(): Promise<void> {
    this.initializeCalled = true;
  }

  dispose(): void {
    this.disposeCalled = true;
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

describe('FrontMcpBridge', () => {
  let registry: AdapterRegistry;
  let mockAdapter: MockAdapter;

  beforeEach(() => {
    registry = new AdapterRegistry();
    mockAdapter = new MockAdapter();
    registry.register('mock', () => mockAdapter);
    resetGlobalBridge();
  });

  describe('initialization', () => {
    it('should initialize with detected adapter', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      expect(bridge.initialized).toBe(true);
      expect(bridge.adapterId).toBe('mock');
      expect(mockAdapter.initializeCalled).toBe(true);
    });

    it('should initialize with forced adapter', async () => {
      const bridge = new FrontMcpBridge({ forceAdapter: 'mock' }, registry);
      await bridge.initialize();

      expect(bridge.adapterId).toBe('mock');
    });

    it('should throw when forced adapter not found', async () => {
      const bridge = new FrontMcpBridge({ forceAdapter: 'nonexistent' }, registry);

      await expect(bridge.initialize()).rejects.toThrow('Forced adapter "nonexistent" not found or disabled');
    });

    it('should throw when no adapter detected', async () => {
      const emptyRegistry = new AdapterRegistry();
      const bridge = new FrontMcpBridge({}, emptyRegistry);

      await expect(bridge.initialize()).rejects.toThrow('No suitable adapter detected');
    });

    it('should not reinitialize if already initialized', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();
      mockAdapter.initializeCalled = false;

      await bridge.initialize();

      expect(mockAdapter.initializeCalled).toBe(false);
    });
  });

  describe('properties', () => {
    it('should expose adapter capabilities', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      expect(bridge.capabilities?.canCallTools).toBe(true);
      expect(bridge.capabilities?.canSendMessages).toBe(true);
    });

    it('should check capabilities', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      expect(bridge.hasCapability('canCallTools')).toBe(true);
      expect(bridge.hasCapability('supportsDisplayModes')).toBe(false);
    });
  });

  describe('data access', () => {
    it('should delegate getTheme to adapter', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      const theme = bridge.getTheme();
      expect(theme).toBe('light'); // Default from BaseAdapter
    });

    it('should delegate getDisplayMode to adapter', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      const mode = bridge.getDisplayMode();
      expect(mode).toBe('inline'); // Default
    });

    it('should delegate getToolInput to adapter', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      const input = bridge.getToolInput();
      expect(input).toEqual({});
    });

    it('should throw if not initialized', () => {
      const bridge = new FrontMcpBridge({}, registry);

      expect(() => bridge.getTheme()).toThrow('not initialized');
    });
  });

  describe('disposal', () => {
    it('should dispose adapter on bridge disposal', async () => {
      const bridge = new FrontMcpBridge({}, registry);
      await bridge.initialize();

      bridge.dispose();

      expect(mockAdapter.disposeCalled).toBe(true);
      expect(bridge.initialized).toBe(false);
    });
  });

  describe('createBridge helper', () => {
    it('should create and initialize bridge', async () => {
      const bridge = await createBridge({}, registry);

      expect(bridge.initialized).toBe(true);
      expect(bridge.adapterId).toBe('mock');
    });
  });

  describe('disabled adapters', () => {
    it('should respect disabledAdapters config', async () => {
      registry.register('fallback', () => {
        const adapter = new MockAdapter();
        (adapter as any).id = 'fallback';
        (adapter as any).priority = 10;
        return adapter;
      });

      const bridge = new FrontMcpBridge({ disabledAdapters: ['mock'] }, registry);
      await bridge.initialize();

      expect(bridge.adapterId).toBe('fallback');
    });
  });
});

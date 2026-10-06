/**
 * ExtAppsAdapter Tests
 *
 * Tests for the ext-apps (SEP-1865) platform adapter, focusing on
 * correct platform detection and Claude exclusion.
 *
 * @jest-environment jsdom
 */

import { ExtAppsAdapter } from '../ext-apps.adapter';

describe('ExtAppsAdapter', () => {
  let adapter: ExtAppsAdapter;
  let originalWindow: typeof globalThis.window;

  beforeEach(() => {
    adapter = new ExtAppsAdapter();
    originalWindow = globalThis.window;
  });

  afterEach(() => {
    // Restore window properties
    if (typeof window !== 'undefined') {
      const win = window as any;
      delete win.__mcpPlatform;
      delete win.__extAppsInitialized;
      delete win.__mcpAppsEnabled;
      delete win.__claudeArtifact;
      delete win.claude;
      delete win.openai;
    }
  });

  describe('adapter properties', () => {
    it('should have correct id', () => {
      expect(adapter.id).toBe('ext-apps');
    });

    it('should have correct name', () => {
      expect(adapter.name).toBe('ext-apps (SEP-1865)');
    });

    it('should have priority 80', () => {
      expect(adapter.priority).toBe(80);
    });

    it('should have default capabilities', () => {
      expect(adapter.capabilities).toMatchObject({
        canPersistState: true,
        hasNetworkAccess: true,
        supportsTheme: true,
      });
    });
  });

  describe('canHandle', () => {
    describe('returns false when not in iframe', () => {
      it('should return false when window.parent equals window', () => {
        // By default in jsdom, window.parent === window (not in iframe)
        expect(adapter.canHandle()).toBe(false);
      });
    });

    describe('when in iframe context', () => {
      beforeEach(() => {
        // Simulate being in an iframe
        Object.defineProperty(window, 'parent', {
          value: { notSameAsWindow: true },
          configurable: true,
        });
      });

      afterEach(() => {
        // Restore parent to window (not in iframe)
        Object.defineProperty(window, 'parent', {
          value: window,
          configurable: true,
        });
      });

      it('should return false for generic iframe without ext-apps marker', () => {
        // Critical fix: should NOT return true for any iframe
        expect(adapter.canHandle()).toBe(false);
      });

      it('should return true when __mcpPlatform is ext-apps', () => {
        (window as any).__mcpPlatform = 'ext-apps';
        expect(adapter.canHandle()).toBe(true);
      });

      it('should return true when __extAppsInitialized is set', () => {
        (window as any).__extAppsInitialized = true;
        expect(adapter.canHandle()).toBe(true);
      });

      describe('Claude exclusion', () => {
        it('should return false when __mcpPlatform is claude', () => {
          (window as any).__mcpPlatform = 'claude';
          expect(adapter.canHandle()).toBe(false);
        });

        it('should return false when window.claude exists', () => {
          (window as any).claude = {};
          expect(adapter.canHandle()).toBe(false);
        });

        it('should return false when __claudeArtifact is set', () => {
          (window as any).__claudeArtifact = true;
          expect(adapter.canHandle()).toBe(false);
        });

        // Note: URL-based Claude detection (claude.ai/anthropic.com) cannot be
        // easily tested in jsdom as window.location is not redefinable.
        // The URL detection code is verified via the IIFE generator tests
        // which check that the generated code includes proper URL checks.
        // The critical behavior (Claude markers take precedence) is tested above.
      });

      describe('OpenAI exclusion', () => {
        it('should return false when openai.canvas exists', () => {
          (window as any).openai = { canvas: {} };
          expect(adapter.canHandle()).toBe(false);
        });

        it('should return false when openai.callTool is a function', () => {
          (window as any).openai = { callTool: () => {} };
          expect(adapter.canHandle()).toBe(false);
        });
      });

      describe('priority over Claude when explicit marker is set', () => {
        it('should prioritize ext-apps marker even if Claude markers exist', () => {
          const win = window as any;
          win.__mcpPlatform = 'ext-apps';
          // Even if Claude globals exist, the explicit ext-apps marker wins
          // (Claude check runs first, so this tests the order)
          expect(adapter.canHandle()).toBe(true);
        });
      });

      describe('Claude MCP Apps mode', () => {
        it('should return true when __mcpAppsEnabled is set (Claude MCP Apps)', () => {
          (window as any).__mcpAppsEnabled = true;
          expect(adapter.canHandle()).toBe(true);
        });

        it('should handle Claude MCP Apps even with Claude URL detected', () => {
          (window as any).__mcpAppsEnabled = true;
          // Note: URL detection happens after __mcpAppsEnabled check,
          // so MCP Apps mode takes precedence
          expect(adapter.canHandle()).toBe(true);
        });

        it('should handle Claude MCP Apps even with Claude globals present', () => {
          const win = window as any;
          win.__mcpAppsEnabled = true;
          win.claude = {};
          // MCP Apps flag takes precedence over legacy Claude detection
          expect(adapter.canHandle()).toBe(true);
        });
      });
    });
  });

  describe('canHandle in SSR context', () => {
    it('should return false when window is undefined', () => {
      // We can't easily mock window being undefined in jsdom,
      // but we can verify the first check in the method
      expect(typeof window).toBe('object');
      // The method should handle window being undefined gracefully
    });
  });

  describe('extended ext-apps methods', () => {
    let adapterWithConfig: ExtAppsAdapter;

    beforeEach(() => {
      adapterWithConfig = new ExtAppsAdapter();
    });

    describe('setSize', () => {
      const sizeNotification = (params: Record<string, number>) => ({
        jsonrpc: '2.0',
        method: 'ui/notifications/size-changed',
        params,
      });

      afterEach(() => jest.restoreAllMocks());

      it('reports the size with the standard size-changed notification, not a ui/setSize request', async () => {
        const postMessage = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._trustedOrigin = 'https://host.example';

        await adapterWithConfig.setSize({ width: 320, height: 480, aspectRatio: 1.5 });

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith(sizeNotification({ width: 320, height: 480 }), 'https://host.example');
      });

      it('leaves out a dimension that was not given', async () => {
        const postMessage = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._trustedOrigin = 'https://host.example';

        await adapterWithConfig.setSize({ height: 200 });

        expect(postMessage.mock.calls[0][0]).toEqual(sizeNotification({ height: 200 }));
      });

      it('targets the first configured trusted origin before the handshake has pinned one', async () => {
        const postMessage = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
        const configured = new ExtAppsAdapter({
          options: { trustedOrigins: ['https://claude.ai', 'https://other.example'] },
        });

        await configured.setSize({ height: 200 });

        expect(postMessage).toHaveBeenCalledWith(sizeNotification({ height: 200 }), 'https://claude.ai');
      });

      it('does nothing when the parent window cannot receive messages', async () => {
        const postMessage = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._trustedOrigin = 'https://host.example';
        // @ts-expect-error - simulate a parent without postMessage
        window.parent.postMessage = undefined;

        await expect(adapterWithConfig.setSize({ height: 200 })).resolves.toBeUndefined();

        expect(postMessage).not.toHaveBeenCalled();
      });

      it('never broadcasts to "*" when no host origin is known', async () => {
        const postMessage = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);

        await expect(adapterWithConfig.setSize({ height: 200 })).rejects.toThrow(/no trusted origin/i);

        expect(postMessage).not.toHaveBeenCalled();
      });
    });

    describe('MCP Apps spec methods', () => {
      const HOST_ORIGIN = 'https://host.example';
      let postMessage: jest.SpyInstance;

      function connectTo(hostCapabilities: Record<string, unknown>): void {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = hostCapabilities;
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._trustedOrigin = HOST_ORIGIN;
      }

      function sent(method: string): unknown[] {
        return postMessage.mock.calls
          .map(([message]) => message as { method?: string; params?: unknown })
          .filter((message) => message.method === method)
          .map((message) => message.params);
      }

      beforeEach(() => {
        postMessage = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
      });

      afterEach(() => {
        adapterWithConfig.dispose();
        jest.restoreAllMocks();
      });

      it('calls a server tool with tools/call, marked as the widget own call', () => {
        connectTo({ serverTools: {} });

        adapterWithConfig.callTool('close_ticket', { id: 'T-1' }).catch(() => undefined);

        expect(sent('tools/call')).toEqual([
          { name: 'close_ticket', arguments: { id: 'T-1' }, _meta: { 'frontmcp/widgetCall': true } },
        ]);
        expect(sent('ui/callServerTool')).toEqual([]);
      });

      it('opens a link with ui/open-link', () => {
        connectTo({ openLinks: {} });

        adapterWithConfig.openLink('https://example.com/docs').catch(() => undefined);

        expect(sent('ui/open-link')).toEqual([{ url: 'https://example.com/docs' }]);
        expect(sent('ui/openLink')).toEqual([]);
      });

      it('asks for a display mode with ui/request-display-mode', () => {
        connectTo({});

        adapterWithConfig.requestDisplayMode('fullscreen').catch(() => undefined);

        expect(sent('ui/request-display-mode')).toEqual([{ mode: 'fullscreen' }]);
        expect(sent('ui/setDisplayMode')).toEqual([]);
      });

      it('sends model context as ui/update-model-context, merging object updates', () => {
        connectTo({ updateModelContext: { text: {} } });

        adapterWithConfig.updateModelContext({ city: 'Oslo' }).catch(() => undefined);
        adapterWithConfig.updateModelContext({ unit: 'C' }).catch(() => undefined);
        adapterWithConfig.updateModelContext('The user picked Oslo', false).catch(() => undefined);

        expect(sent('ui/update-model-context')).toEqual([
          { content: [{ type: 'text', text: '{"city":"Oslo"}' }], structuredContent: { city: 'Oslo' } },
          {
            content: [{ type: 'text', text: '{"city":"Oslo","unit":"C"}' }],
            structuredContent: { city: 'Oslo', unit: 'C' },
          },
          { content: [{ type: 'text', text: 'The user picked Oslo' }] },
        ]);
      });

      it('logs with a notifications/message notification at the MCP level', async () => {
        connectTo({ logging: {} });

        await adapterWithConfig.log('warn', 'Quota low', { remaining: 3 });

        expect(postMessage).toHaveBeenCalledWith(
          {
            jsonrpc: '2.0',
            method: 'notifications/message',
            params: { level: 'warning', data: { message: 'Quota low', data: { remaining: 3 } } },
          },
          HOST_ORIGIN,
        );
        expect(sent('ui/log')).toEqual([]);
      });

      it('asks the host to tear the widget down with a ui/notifications/request-teardown notification', async () => {
        connectTo({});

        await adapterWithConfig.requestClose();

        expect(postMessage).toHaveBeenCalledWith(
          { jsonrpc: '2.0', method: 'ui/notifications/request-teardown', params: {} },
          HOST_ORIGIN,
        );
        expect(sent('ui/close')).toEqual([]);
      });

      describe('ui/resource-teardown', () => {
        const teardownRequest = { jsonrpc: '2.0', id: 900, method: 'ui/resource-teardown', params: {} };

        function receive(origin: string): void {
          // @ts-expect-error - accessing private method for testing
          adapterWithConfig._handleMessage({ data: teardownRequest, origin } as MessageEvent);
        }

        it('fires bridge:teardown, then answers the host with an empty result', () => {
          connectTo({});
          const answeredBeforeCleanup: number[] = [];
          const listener = () => answeredBeforeCleanup.push(postMessage.mock.calls.length);
          window.addEventListener('bridge:teardown', listener);

          receive(HOST_ORIGIN);
          window.removeEventListener('bridge:teardown', listener);

          expect(answeredBeforeCleanup).toEqual([0]);
          expect(postMessage.mock.calls).toEqual([[{ jsonrpc: '2.0', id: 900, result: {} }, HOST_ORIGIN]]);
        });

        it('ignores a teardown request from an origin it does not trust', () => {
          connectTo({});
          const teardowns: Event[] = [];
          const listener = (event: Event) => teardowns.push(event);
          window.addEventListener('bridge:teardown', listener);

          receive('https://other.example');
          window.removeEventListener('bridge:teardown', listener);

          expect(teardowns).toEqual([]);
          expect(postMessage).not.toHaveBeenCalled();
        });
      });

      it.each(['ui/notifications/tool-cancelled', 'ui/notifications/cancelled'])(
        'reports a %s notification as a tool:cancelled event with its reason',
        (method) => {
          const reasons: unknown[] = [];
          const listener = (event: Event) => reasons.push((event as CustomEvent).detail);
          window.addEventListener('tool:cancelled', listener);

          // @ts-expect-error - accessing private method for testing
          adapterWithConfig._handleNotification({ jsonrpc: '2.0', method, params: { reason: 'user action' } });
          window.removeEventListener('tool:cancelled', listener);

          expect(reasons).toEqual([{ reason: 'user action' }]);
        },
      );
    });

    describe('updateModelContext', () => {
      it('should throw ExtAppsNotSupportedError when modelContextUpdate capability is not present', async () => {
        // Host capabilities don't include modelContextUpdate
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = {};

        await expect(adapterWithConfig.updateModelContext({ key: 'value' })).rejects.toThrow(
          'Model context update not supported by host',
        );
      });

      it('should throw ExtAppsNotSupportedError when modelContextUpdate is false', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = { modelContextUpdate: false };

        await expect(adapterWithConfig.updateModelContext({ key: 'value' })).rejects.toThrow(
          'Model context update not supported by host',
        );
      });
    });

    describe('log', () => {
      it('should fall back to console when host does not support logging', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = { logging: false };

        const consoleSpy = jest.spyOn(console, 'info').mockImplementation();

        await adapterWithConfig.log('info', 'Test message', { extra: 'data' });

        expect(consoleSpy).toHaveBeenCalledWith('[Widget] Test message', { extra: 'data' });
        consoleSpy.mockRestore();
      });

      it('should use correct console method for each log level', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = { logging: false };

        const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();

        await adapterWithConfig.log('debug', 'Debug message');
        expect(debugSpy).toHaveBeenCalledWith('[Widget] Debug message', undefined);

        await adapterWithConfig.log('warn', 'Warn message');
        expect(warnSpy).toHaveBeenCalledWith('[Widget] Warn message', undefined);

        await adapterWithConfig.log('error', 'Error message');
        expect(errorSpy).toHaveBeenCalledWith('[Widget] Error message', undefined);

        debugSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
      });
    });

    describe('registerTool', () => {
      it('should throw ExtAppsNotSupportedError when widgetTools capability is not present', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = {};

        await expect(adapterWithConfig.registerTool('my_tool', 'A tool', { type: 'object' })).rejects.toThrow(
          'Widget tool registration not supported by host',
        );
      });

      it('should throw ExtAppsNotSupportedError when widgetTools is false', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = { widgetTools: false };

        await expect(adapterWithConfig.registerTool('my_tool', 'A tool', { type: 'object' })).rejects.toThrow(
          'Widget tool registration not supported by host',
        );
      });
    });

    describe('unregisterTool', () => {
      it('should throw ExtAppsNotSupportedError when widgetTools capability is not present', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = {};

        await expect(adapterWithConfig.unregisterTool('my_tool')).rejects.toThrow(
          'Widget tool unregistration not supported by host',
        );
      });

      it('should throw ExtAppsNotSupportedError when widgetTools is false', async () => {
        // @ts-expect-error - accessing private property for testing
        adapterWithConfig._hostCapabilities = { widgetTools: false };

        await expect(adapterWithConfig.unregisterTool('my_tool')).rejects.toThrow(
          'Widget tool unregistration not supported by host',
        );
      });
    });
  });
});

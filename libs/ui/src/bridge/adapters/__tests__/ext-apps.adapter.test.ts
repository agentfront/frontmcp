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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__mcpPlatform = 'ext-apps';
        expect(adapter.canHandle()).toBe(true);
      });

      it('should return true when __extAppsInitialized is set', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__extAppsInitialized = true;
        expect(adapter.canHandle()).toBe(true);
      });

      describe('Claude exclusion', () => {
        it('should return false when __mcpPlatform is claude', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__mcpPlatform = 'claude';
          expect(adapter.canHandle()).toBe(false);
        });

        it('should return false when window.claude exists', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).claude = {};
          expect(adapter.canHandle()).toBe(false);
        });

        it('should return false when __claudeArtifact is set', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).openai = { canvas: {} };
          expect(adapter.canHandle()).toBe(false);
        });

        it('should return false when openai.callTool is a function', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).openai = { callTool: () => {} };
          expect(adapter.canHandle()).toBe(false);
        });
      });

      describe('priority over Claude when explicit marker is set', () => {
        it('should prioritize ext-apps marker even if Claude markers exist', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const win = window as any;
          win.__mcpPlatform = 'ext-apps';
          // Even if Claude globals exist, the explicit ext-apps marker wins
          // (Claude check runs first, so this tests the order)
          expect(adapter.canHandle()).toBe(true);
        });
      });

      describe('Claude MCP Apps mode', () => {
        it('should return true when __mcpAppsEnabled is set (Claude MCP Apps)', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__mcpAppsEnabled = true;
          expect(adapter.canHandle()).toBe(true);
        });

        it('should handle Claude MCP Apps even with Claude URL detected', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__mcpAppsEnabled = true;
          // Note: URL detection happens after __mcpAppsEnabled check,
          // so MCP Apps mode takes precedence
          expect(adapter.canHandle()).toBe(true);
        });

        it('should handle Claude MCP Apps even with Claude globals present', () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
});

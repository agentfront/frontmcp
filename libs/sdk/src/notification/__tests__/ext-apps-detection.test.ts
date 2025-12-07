/**
 * @file ext-apps-detection.test.ts
 * @description Tests for MCP Apps (ext-apps) platform detection.
 */

import {
  detectPlatformFromCapabilities,
  hasMcpAppsExtension,
  MCP_APPS_EXTENSION_KEY,
  type ClientCapabilities,
} from '../notification.service';

describe('MCP Apps Platform Detection', () => {
  describe('MCP_APPS_EXTENSION_KEY', () => {
    it('should have correct extension key', () => {
      expect(MCP_APPS_EXTENSION_KEY).toBe('io.modelcontextprotocol/ui');
    });
  });

  describe('hasMcpAppsExtension', () => {
    it('should return true when extension is present', () => {
      const capabilities: ClientCapabilities = {
        experimental: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html+mcp'],
          },
        },
      };
      expect(hasMcpAppsExtension(capabilities)).toBe(true);
    });

    it('should return true when extension is present but empty', () => {
      const capabilities: ClientCapabilities = {
        experimental: {
          'io.modelcontextprotocol/ui': {},
        },
      };
      expect(hasMcpAppsExtension(capabilities)).toBe(true);
    });

    it('should return false when extension is not present', () => {
      const capabilities: ClientCapabilities = {
        experimental: {
          'some-other-extension': {},
        },
      };
      expect(hasMcpAppsExtension(capabilities)).toBe(false);
    });

    it('should return false when experimental is undefined', () => {
      const capabilities: ClientCapabilities = {};
      expect(hasMcpAppsExtension(capabilities)).toBe(false);
    });

    it('should return false for undefined capabilities', () => {
      expect(hasMcpAppsExtension(undefined)).toBe(false);
    });

    it('should return false when extension value is null', () => {
      const capabilities: ClientCapabilities = {
        experimental: {
          'io.modelcontextprotocol/ui': null as unknown as { mimeTypes?: string[] },
        },
      };
      expect(hasMcpAppsExtension(capabilities)).toBe(false);
    });
  });

  describe('detectPlatformFromCapabilities', () => {
    it('should detect ext-apps when MCP Apps extension is present', () => {
      const capabilities: ClientCapabilities = {
        experimental: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html+mcp'],
          },
        },
      };
      expect(detectPlatformFromCapabilities(capabilities)).toBe('ext-apps');
    });

    it('should return undefined when no recognized extension', () => {
      const capabilities: ClientCapabilities = {
        roots: { listChanged: true },
      };
      expect(detectPlatformFromCapabilities(capabilities)).toBeUndefined();
    });

    it('should return undefined for undefined capabilities', () => {
      expect(detectPlatformFromCapabilities(undefined)).toBeUndefined();
    });

    it('should return undefined for empty capabilities', () => {
      expect(detectPlatformFromCapabilities({})).toBeUndefined();
    });
  });

  describe('ClientCapabilities interface', () => {
    it('should support MCP Apps extension structure', () => {
      const capabilities: ClientCapabilities = {
        roots: { listChanged: true },
        sampling: { temperature: 0.7 },
        experimental: {
          'io.modelcontextprotocol/ui': {
            mimeTypes: ['text/html+mcp'],
          },
          'some.other/extension': { enabled: true },
        },
      };

      expect(capabilities.experimental?.[MCP_APPS_EXTENSION_KEY]).toBeDefined();
      expect(capabilities.experimental?.[MCP_APPS_EXTENSION_KEY]?.mimeTypes).toContain('text/html+mcp');
    });
  });
});

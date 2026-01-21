/**
 * Tests for supportsElicitation helper function.
 */
import { supportsElicitation, type ClientCapabilities } from '../notification.service';

describe('supportsElicitation', () => {
  describe('when capabilities is undefined or has no elicitation', () => {
    it('should return false when capabilities is undefined', () => {
      expect(supportsElicitation(undefined)).toBe(false);
    });

    it('should return false when capabilities is empty object', () => {
      const capabilities: ClientCapabilities = {};
      expect(supportsElicitation(capabilities)).toBe(false);
    });

    it('should return false when elicitation is undefined', () => {
      const capabilities: ClientCapabilities = {
        roots: { listChanged: true },
      };
      expect(supportsElicitation(capabilities)).toBe(false);
    });

    it('should return false when elicitation is empty object', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {},
      };
      expect(supportsElicitation(capabilities)).toBe(false);
    });
  });

  describe('form mode support', () => {
    it('should return true when form mode is supported and checking any mode', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(capabilities)).toBe(true);
    });

    it('should return true when form mode is supported and checking form mode specifically', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(capabilities, 'form')).toBe(true);
    });

    it('should return false when only form mode is supported but checking url mode', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(capabilities, 'url')).toBe(false);
    });

    it('should return true when form has additional properties', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: { version: '1.0', maxFields: 10 },
        },
      };

      expect(supportsElicitation(capabilities, 'form')).toBe(true);
    });
  });

  describe('url mode support', () => {
    it('should return true when url mode is supported and checking any mode', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          url: {},
        },
      };

      expect(supportsElicitation(capabilities)).toBe(true);
    });

    it('should return true when url mode is supported and checking url mode specifically', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          url: {},
        },
      };

      expect(supportsElicitation(capabilities, 'url')).toBe(true);
    });

    it('should return false when only url mode is supported but checking form mode', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          url: {},
        },
      };

      expect(supportsElicitation(capabilities, 'form')).toBe(false);
    });

    it('should return true when url has additional properties', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          url: { redirectUris: ['https://example.com/callback'] },
        },
      };

      expect(supportsElicitation(capabilities, 'url')).toBe(true);
    });
  });

  describe('both modes supported', () => {
    const capabilitiesWithBoth: ClientCapabilities = {
      elicitation: {
        form: {},
        url: {},
      },
    };

    it('should return true when checking any mode', () => {
      expect(supportsElicitation(capabilitiesWithBoth)).toBe(true);
    });

    it('should return true when checking form mode', () => {
      expect(supportsElicitation(capabilitiesWithBoth, 'form')).toBe(true);
    });

    it('should return true when checking url mode', () => {
      expect(supportsElicitation(capabilitiesWithBoth, 'url')).toBe(true);
    });
  });

  describe('with other capabilities present', () => {
    it('should correctly detect elicitation alongside other capabilities', () => {
      const capabilities: ClientCapabilities = {
        roots: { listChanged: true },
        sampling: { enabled: true },
        experimental: {
          'io.modelcontextprotocol/ui': { mimeTypes: ['text/html+mcp'] },
        },
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(capabilities)).toBe(true);
      expect(supportsElicitation(capabilities, 'form')).toBe(true);
      expect(supportsElicitation(capabilities, 'url')).toBe(false);
    });

    it('should return false when elicitation is missing but other capabilities present', () => {
      const capabilities: ClientCapabilities = {
        roots: { listChanged: true },
        sampling: { enabled: true },
        experimental: {
          'io.modelcontextprotocol/ui': { mimeTypes: ['text/html+mcp'] },
        },
      };

      expect(supportsElicitation(capabilities)).toBe(false);
      expect(supportsElicitation(capabilities, 'form')).toBe(false);
      expect(supportsElicitation(capabilities, 'url')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle undefined mode parameter same as no mode', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(capabilities, undefined)).toBe(true);
    });

    it('should return true if form is present even with empty object', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(capabilities, 'form')).toBe(true);
    });

    it('should return true if url is present even with empty object', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          url: {},
        },
      };

      expect(supportsElicitation(capabilities, 'url')).toBe(true);
    });

    it('should handle complex elicitation config', () => {
      const capabilities: ClientCapabilities = {
        elicitation: {
          form: {
            version: '2.0',
            supportedFieldTypes: ['text', 'number', 'boolean', 'select'],
            maxFields: 20,
          },
          url: {
            version: '1.0',
            allowedSchemes: ['https'],
            maxRedirects: 3,
          },
        },
      };

      expect(supportsElicitation(capabilities)).toBe(true);
      expect(supportsElicitation(capabilities, 'form')).toBe(true);
      expect(supportsElicitation(capabilities, 'url')).toBe(true);
    });
  });

  describe('practical scenarios', () => {
    it('should work with typical Claude Desktop capabilities', () => {
      const claudeCapabilities: ClientCapabilities = {
        roots: { listChanged: true },
        sampling: {},
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(claudeCapabilities)).toBe(true);
      expect(supportsElicitation(claudeCapabilities, 'form')).toBe(true);
      expect(supportsElicitation(claudeCapabilities, 'url')).toBe(false);
    });

    it('should work with minimal client capabilities', () => {
      const minimalCapabilities: ClientCapabilities = {
        elicitation: {
          form: {},
        },
      };

      expect(supportsElicitation(minimalCapabilities)).toBe(true);
    });

    it('should work with client that supports both OAuth and form elicitation', () => {
      const fullCapabilities: ClientCapabilities = {
        roots: { listChanged: true },
        sampling: {},
        experimental: {},
        elicitation: {
          form: { version: '1.0' },
          url: { version: '1.0' },
        },
      };

      expect(supportsElicitation(fullCapabilities)).toBe(true);
      expect(supportsElicitation(fullCapabilities, 'form')).toBe(true);
      expect(supportsElicitation(fullCapabilities, 'url')).toBe(true);
    });

    it('should return false for legacy clients without elicitation', () => {
      const legacyCapabilities: ClientCapabilities = {
        roots: {},
      };

      expect(supportsElicitation(legacyCapabilities)).toBe(false);
    });
  });
});

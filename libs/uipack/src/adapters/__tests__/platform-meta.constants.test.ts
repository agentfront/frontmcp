/**
 * @file platform-meta.constants.test.ts
 * @description Tests for platform metadata constants and mapDisplayMode function.
 */

import { mapDisplayMode, DISPLAY_MODE_MAP, type ExtAppsDisplayMode } from '../platform-meta.constants';

describe('platform-meta.constants', () => {
  describe('DISPLAY_MODE_MAP', () => {
    it('should have standard MCP Apps modes', () => {
      expect(DISPLAY_MODE_MAP).toHaveProperty('inline', 'inline');
      expect(DISPLAY_MODE_MAP).toHaveProperty('fullscreen', 'fullscreen');
      expect(DISPLAY_MODE_MAP).toHaveProperty('pip', 'pip');
    });

    it('should have OpenAI-style aliases', () => {
      expect(DISPLAY_MODE_MAP).toHaveProperty('widget', 'inline');
      expect(DISPLAY_MODE_MAP).toHaveProperty('panel', 'fullscreen');
    });
  });

  describe('mapDisplayMode', () => {
    describe('standard MCP Apps modes', () => {
      it('should pass through inline mode', () => {
        expect(mapDisplayMode('inline')).toBe('inline');
      });

      it('should pass through fullscreen mode', () => {
        expect(mapDisplayMode('fullscreen')).toBe('fullscreen');
      });

      it('should pass through pip mode', () => {
        expect(mapDisplayMode('pip')).toBe('pip');
      });
    });

    describe('OpenAI-style aliases', () => {
      it('should map widget to inline', () => {
        expect(mapDisplayMode('widget')).toBe('inline');
      });

      it('should map panel to fullscreen', () => {
        expect(mapDisplayMode('panel')).toBe('fullscreen');
      });
    });

    describe('unknown inputs', () => {
      it('should return undefined for unknown mode', () => {
        expect(mapDisplayMode('unknownMode')).toBeUndefined();
      });

      it('should return undefined for empty string', () => {
        expect(mapDisplayMode('')).toBeUndefined();
      });

      it('should return undefined for case-sensitive mismatch', () => {
        expect(mapDisplayMode('INLINE')).toBeUndefined();
        expect(mapDisplayMode('Fullscreen')).toBeUndefined();
        expect(mapDisplayMode('PIP')).toBeUndefined();
      });

      it('should return undefined for typos', () => {
        expect(mapDisplayMode('full-screen')).toBeUndefined();
        expect(mapDisplayMode('picture-in-picture')).toBeUndefined();
      });
    });

    describe('type safety', () => {
      it('should return valid ExtAppsDisplayMode for known modes', () => {
        const result: ExtAppsDisplayMode | undefined = mapDisplayMode('inline');
        expect(result).toBeDefined();
        expect(['inline', 'fullscreen', 'pip']).toContain(result);
      });
    });
  });
});

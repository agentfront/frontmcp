import {
  CDN,
  buildCdnScripts,
  buildFontPreconnect,
  buildFontStylesheets,
  fetchScript,
  getCachedScript,
  isScriptCached,
  clearScriptCache,
  fetchAndCacheScripts,
} from './cdn';

describe('CDN Module', () => {
  describe('CDN constants', () => {
    it('should have Tailwind v4 browser CDN URL', () => {
      expect(CDN.tailwind).toContain('@tailwindcss/browser');
    });

    it('should have HTMX CDN URL', () => {
      expect(CDN.htmx.url).toContain('htmx');
      expect(CDN.htmx.integrity).toBeDefined();
    });

    it('should have Alpine.js CDN URL', () => {
      expect(CDN.alpine.url).toContain('alpinejs');
    });

    it('should have Lucide icons CDN URL', () => {
      expect(CDN.icons.url).toContain('lucide');
    });

    it('should have Google Fonts preconnect URLs', () => {
      expect(CDN.fonts.preconnect).toContain('https://fonts.googleapis.com');
      expect(CDN.fonts.preconnect).toContain('https://fonts.gstatic.com');
    });

    it('should have Inter font URL', () => {
      expect(CDN.fonts.inter).toContain('fonts.googleapis.com');
      expect(CDN.fonts.inter).toContain('Inter');
    });

    it('should have mono font URL', () => {
      expect(CDN.fonts.mono).toContain('fonts.googleapis.com');
      expect(CDN.fonts.mono).toContain('JetBrains+Mono');
    });
  });

  describe('buildCdnScripts', () => {
    it('should build Tailwind script when enabled', () => {
      const scripts = buildCdnScripts({ tailwind: true, htmx: false });
      expect(scripts).toContain('tailwindcss/browser');
    });

    it('should build HTMX script when enabled', () => {
      const scripts = buildCdnScripts({ tailwind: false, htmx: true });
      expect(scripts).toContain('htmx');
    });

    it('should build Alpine script when enabled', () => {
      const scripts = buildCdnScripts({
        tailwind: false,
        htmx: false,
        alpine: true,
      });
      expect(scripts).toContain('alpinejs');
    });

    it('should build icons script when enabled', () => {
      const scripts = buildCdnScripts({
        tailwind: false,
        htmx: false,
        icons: true,
      });
      expect(scripts).toContain('lucide');
    });

    it('should return empty string when all explicitly disabled', () => {
      const scripts = buildCdnScripts({
        tailwind: false,
        htmx: false,
        alpine: false,
        icons: false,
      });
      expect(scripts.trim()).toBe('');
    });

    it('should include Tailwind and HTMX by default', () => {
      const scripts = buildCdnScripts();
      expect(scripts).toContain('tailwindcss');
      expect(scripts).toContain('htmx');
    });

    it('should combine multiple scripts', () => {
      const scripts = buildCdnScripts({
        tailwind: true,
        htmx: true,
      });
      expect(scripts).toContain('tailwindcss');
      expect(scripts).toContain('htmx');
    });

    it('should include integrity attribute for HTMX', () => {
      const scripts = buildCdnScripts({ tailwind: false, htmx: true });
      expect(scripts).toContain('integrity=');
      expect(scripts).toContain('crossorigin="anonymous"');
    });

    it('should include defer attribute for Alpine.js', () => {
      const scripts = buildCdnScripts({
        tailwind: false,
        htmx: false,
        alpine: true,
      });
      expect(scripts).toContain('defer');
    });
  });

  describe('buildFontPreconnect', () => {
    it('should return preconnect links for Google Fonts', () => {
      const preconnect = buildFontPreconnect();
      expect(preconnect).toContain('fonts.googleapis.com');
      expect(preconnect).toContain('fonts.gstatic.com');
      expect(preconnect).toContain('rel="preconnect"');
    });

    it('should include crossorigin attribute for gstatic', () => {
      const preconnect = buildFontPreconnect();
      expect(preconnect).toContain('crossorigin');
    });
  });

  describe('buildFontStylesheets', () => {
    it('should build Inter font stylesheet by default', () => {
      const stylesheets = buildFontStylesheets();
      expect(stylesheets).toContain('fonts.googleapis.com');
      expect(stylesheets).toContain('Inter');
    });

    it('should build Inter font stylesheet when explicitly enabled', () => {
      const stylesheets = buildFontStylesheets({ inter: true });
      expect(stylesheets).toContain('fonts.googleapis.com');
      expect(stylesheets).toContain('Inter');
    });

    it('should build mono font stylesheet when enabled', () => {
      const stylesheets = buildFontStylesheets({ inter: false, mono: true });
      expect(stylesheets).toContain('JetBrains+Mono');
    });

    it('should combine Inter and mono fonts', () => {
      const stylesheets = buildFontStylesheets({
        inter: true,
        mono: true,
      });
      expect(stylesheets).toContain('Inter');
      expect(stylesheets).toContain('JetBrains+Mono');
    });

    it('should return empty string when all fonts disabled', () => {
      const stylesheets = buildFontStylesheets({ inter: false, mono: false });
      expect(stylesheets.trim()).toBe('');
    });
  });

  describe('Script Caching', () => {
    beforeEach(() => {
      clearScriptCache();
    });

    describe('fetchScript', () => {
      it('should fetch and cache a script', async () => {
        // Mock fetch
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('console.log("test script");'),
        });

        const content = await fetchScript('https://example.com/script.js');
        expect(content).toBe('console.log("test script");');
        expect(isScriptCached('https://example.com/script.js')).toBe(true);
      });

      it('should return cached script on subsequent calls', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('cached content'),
        });

        await fetchScript('https://example.com/cached.js');
        const second = await fetchScript('https://example.com/cached.js');

        expect(second).toBe('cached content');
        // Should only have called fetch once
        expect(global.fetch).toHaveBeenCalledTimes(1);
      });

      it('should throw error on fetch failure', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 404,
        });

        await expect(fetchScript('https://example.com/notfound.js')).rejects.toThrow('Failed to fetch script');
      });
    });

    describe('getCachedScript', () => {
      it('should return undefined for uncached scripts', () => {
        expect(getCachedScript('https://example.com/unknown.js')).toBeUndefined();
      });

      it('should return cached script content', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('test content'),
        });

        await fetchScript('https://example.com/test.js');
        expect(getCachedScript('https://example.com/test.js')).toBe('test content');
      });
    });

    describe('isScriptCached', () => {
      it('should return false for uncached scripts', () => {
        expect(isScriptCached('https://example.com/unknown.js')).toBe(false);
      });

      it('should return true for cached scripts', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('content'),
        });

        await fetchScript('https://example.com/exists.js');
        expect(isScriptCached('https://example.com/exists.js')).toBe(true);
      });
    });

    describe('clearScriptCache', () => {
      it('should clear all cached scripts', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('content'),
        });

        await fetchScript('https://example.com/script1.js');
        await fetchScript('https://example.com/script2.js');

        expect(isScriptCached('https://example.com/script1.js')).toBe(true);
        expect(isScriptCached('https://example.com/script2.js')).toBe(true);

        clearScriptCache();

        expect(isScriptCached('https://example.com/script1.js')).toBe(false);
        expect(isScriptCached('https://example.com/script2.js')).toBe(false);
      });
    });

    describe('fetchAndCacheScripts', () => {
      it('should fetch tailwind and htmx by default', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('script content'),
        });

        await fetchAndCacheScripts();

        expect(isScriptCached(CDN.tailwind)).toBe(true);
        expect(isScriptCached(CDN.htmx.url)).toBe(true);
      });

      it('should fetch selected scripts', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('script content'),
        });

        await fetchAndCacheScripts({
          tailwind: false,
          htmx: false,
          alpine: true,
          icons: true,
        });

        expect(isScriptCached(CDN.tailwind)).toBe(false);
        expect(isScriptCached(CDN.alpine.url)).toBe(true);
        expect(isScriptCached(CDN.icons.url)).toBe(true);
      });

      it('should return the script cache', async () => {
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('script content'),
        });

        const cache = await fetchAndCacheScripts({ tailwind: true, htmx: false });
        expect(cache).toBeInstanceOf(Map);
        expect(cache.has(CDN.tailwind)).toBe(true);
      });
    });

    describe('buildCdnScripts with inline option', () => {
      it('should use inline scripts from cache', async () => {
        global.fetch = jest
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve('tailwind inline content'),
          })
          .mockResolvedValueOnce({
            ok: true,
            text: () => Promise.resolve('htmx inline content'),
          });

        await fetchAndCacheScripts({ tailwind: true, htmx: true });

        const scripts = buildCdnScripts({ tailwind: true, htmx: true, inline: true });
        expect(scripts).toContain('tailwind inline content');
        expect(scripts).toContain('htmx inline content');
      });

      it('should skip uncached scripts when inline', () => {
        clearScriptCache();
        const scripts = buildCdnScripts({
          tailwind: true,
          htmx: true,
          alpine: true,
          icons: true,
          inline: true,
        });
        expect(scripts.trim()).toBe('');
      });
    });
  });
});

/**
 * CDN Resources Tests
 *
 * Tests for CDN URL constants and helper functions.
 */

import {
  REACT_CDN,
  REACT_DOM_CDN,
  MARKED_CDN,
  HANDLEBARS_CDN,
  MDX_RUNTIME_CDN,
  TAILWIND_CDN,
  getDefaultAssets,
  buildCDNScriptTag,
  buildScriptsForUIType,
  buildTailwindScriptTag,
  hasInlineScripts,
  getURLsToPreFetch,
} from '../cdn-resources';
import type { CDNResource, UIType, ResourceMode } from '../../types';

describe('CDN URL Constants', () => {
  describe('REACT_CDN', () => {
    it('should have a valid URL', () => {
      // React 19 from esm.sh (ES modules)
      expect(REACT_CDN.url).toBe('https://esm.sh/react@19');
    });

    it('should have crossorigin set to anonymous', () => {
      expect(REACT_CDN.crossorigin).toBe('anonymous');
    });
  });

  describe('REACT_DOM_CDN', () => {
    it('should have a valid URL', () => {
      // ReactDOM 19 client from esm.sh (ES modules)
      expect(REACT_DOM_CDN.url).toBe('https://esm.sh/react-dom@19/client');
    });

    it('should have crossorigin set to anonymous', () => {
      expect(REACT_DOM_CDN.crossorigin).toBe('anonymous');
    });
  });

  describe('MARKED_CDN', () => {
    it('should have a valid URL', () => {
      expect(MARKED_CDN.url).toBe('https://unpkg.com/marked@latest/marked.min.js');
    });
  });

  describe('HANDLEBARS_CDN', () => {
    it('should have a valid URL', () => {
      expect(HANDLEBARS_CDN.url).toBe('https://unpkg.com/handlebars@latest/dist/handlebars.min.js');
    });
  });

  describe('MDX_RUNTIME_CDN', () => {
    it('should have a valid URL', () => {
      expect(MDX_RUNTIME_CDN.url).toBe('https://esm.sh/@mdx-js/mdx@3?bundle');
    });
  });

  describe('TAILWIND_CDN', () => {
    it('should have a valid URL', () => {
      expect(TAILWIND_CDN.url).toBe('https://cdn.tailwindcss.com');
    });
  });
});

describe('getDefaultAssets', () => {
  describe('cdn mode', () => {
    it('should return CDN assets for html type', () => {
      const assets = getDefaultAssets('html', 'cdn');
      expect(assets.mode).toBe('cdn');
      expect(assets.tailwind).toEqual(TAILWIND_CDN);
      expect(assets.handlebars).toEqual(HANDLEBARS_CDN);
      expect(assets.react).toBeUndefined();
    });

    it('should return CDN assets for react type', () => {
      const assets = getDefaultAssets('react', 'cdn');
      expect(assets.mode).toBe('cdn');
      expect(assets.react).toEqual(REACT_CDN);
      expect(assets.reactDom).toEqual(REACT_DOM_CDN);
      expect(assets.tailwind).toEqual(TAILWIND_CDN);
    });

    it('should return CDN assets for mdx type', () => {
      const assets = getDefaultAssets('mdx', 'cdn');
      expect(assets.mode).toBe('cdn');
      expect(assets.react).toEqual(REACT_CDN);
      expect(assets.reactDom).toEqual(REACT_DOM_CDN);
      expect(assets.mdxRuntime).toEqual(MDX_RUNTIME_CDN);
      expect(assets.markdown).toEqual(MARKED_CDN);
    });

    it('should return CDN assets for markdown type', () => {
      const assets = getDefaultAssets('markdown', 'cdn');
      expect(assets.mode).toBe('cdn');
      expect(assets.markdown).toEqual(MARKED_CDN);
      expect(assets.react).toBeUndefined();
    });

    it('should return CDN assets for auto type with all renderers', () => {
      const assets = getDefaultAssets('auto', 'cdn');
      expect(assets.mode).toBe('cdn');
      expect(assets.react).toEqual(REACT_CDN);
      expect(assets.reactDom).toEqual(REACT_DOM_CDN);
      expect(assets.markdown).toEqual(MARKED_CDN);
      expect(assets.handlebars).toEqual(HANDLEBARS_CDN);
    });
  });

  describe('inline mode', () => {
    it('should return inline mode assets', () => {
      const assets = getDefaultAssets('react', 'inline');
      expect(assets.mode).toBe('inline');
      // In inline mode, we still return CDN URLs but the mode is 'inline'
      // The actual inline scripts would be populated at build time
    });
  });

  describe('default mode', () => {
    it('should default to cdn mode when mode is not specified', () => {
      const assets = getDefaultAssets('react');
      expect(assets.mode).toBe('cdn');
    });
  });
});

describe('buildCDNScriptTag', () => {
  it('should build a basic script tag', () => {
    const resource: CDNResource = {
      url: 'https://example.com/script.js',
    };
    const tag = buildCDNScriptTag(resource);
    expect(tag).toBe('<script src="https://example.com/script.js"></script>');
  });

  it('should include crossorigin attribute', () => {
    const resource: CDNResource = {
      url: 'https://example.com/script.js',
      crossorigin: 'anonymous',
    };
    const tag = buildCDNScriptTag(resource);
    expect(tag).toContain('crossorigin="anonymous"');
  });

  it('should include integrity attribute', () => {
    const resource: CDNResource = {
      url: 'https://example.com/script.js',
      integrity: 'sha384-abc123',
      crossorigin: 'anonymous',
    };
    const tag = buildCDNScriptTag(resource);
    expect(tag).toContain('integrity="sha384-abc123"');
    expect(tag).toContain('crossorigin="anonymous"');
  });

  it('should include async attribute when specified', () => {
    const resource: CDNResource = { url: 'https://example.com/script.js' };
    const tag = buildCDNScriptTag(resource, { async: true });
    expect(tag).toContain('async');
  });

  it('should include defer attribute when specified', () => {
    const resource: CDNResource = { url: 'https://example.com/script.js' };
    const tag = buildCDNScriptTag(resource, { defer: true });
    expect(tag).toContain('defer');
  });

  it('should include type attribute when specified', () => {
    const resource: CDNResource = { url: 'https://example.com/script.js' };
    const tag = buildCDNScriptTag(resource, { type: 'module' });
    expect(tag).toContain('type="module"');
  });
});

describe('buildScriptsForUIType', () => {
  it('should return empty array for inline mode', () => {
    const scripts = buildScriptsForUIType('react', 'inline');
    expect(scripts).toEqual([]);
  });

  it('should return React scripts for react type in cdn mode', () => {
    const scripts = buildScriptsForUIType('react', 'cdn');
    expect(scripts.length).toBe(2);
    // React 19 from esm.sh
    expect(scripts[0]).toContain('esm.sh/react@19');
    expect(scripts[1]).toContain('esm.sh/react-dom@19');
  });

  it('should return React and MDX scripts for mdx type', () => {
    const scripts = buildScriptsForUIType('mdx', 'cdn');
    expect(scripts.length).toBeGreaterThan(2);
    // React 19 from esm.sh
    expect(scripts.some(s => s.includes('esm.sh/react@19'))).toBe(true);
    expect(scripts.some(s => s.includes('esm.sh/react-dom@19'))).toBe(true);
    expect(scripts.some(s => s.includes('marked'))).toBe(true);
    // MDX runtime should have type="module"
    expect(scripts.some(s => s.includes('type="module"'))).toBe(true);
  });

  it('should return markdown scripts for markdown type', () => {
    const scripts = buildScriptsForUIType('markdown', 'cdn');
    expect(scripts.some(s => s.includes('marked'))).toBe(true);
  });

  it('should return handlebars scripts for html type', () => {
    const scripts = buildScriptsForUIType('html', 'cdn');
    expect(scripts.some(s => s.includes('handlebars'))).toBe(true);
  });

  it('should return all scripts for auto type', () => {
    const scripts = buildScriptsForUIType('auto', 'cdn');
    // React 19 from esm.sh (ES modules)
    expect(scripts.some(s => s.includes('esm.sh/react@19'))).toBe(true);
    expect(scripts.some(s => s.includes('marked'))).toBe(true);
    expect(scripts.some(s => s.includes('handlebars'))).toBe(true);
  });
});

describe('buildTailwindScriptTag', () => {
  it('should build basic Tailwind script tag', () => {
    const tag = buildTailwindScriptTag();
    expect(tag).toContain('cdn.tailwindcss.com');
    expect(tag).toContain('<script');
  });

  it('should include Tailwind config when provided', () => {
    const config = '{ theme: { extend: {} } }';
    const tag = buildTailwindScriptTag(config);
    expect(tag).toContain('cdn.tailwindcss.com');
    expect(tag).toContain('tailwind.config');
    expect(tag).toContain(config);
  });
});

describe('hasInlineScripts', () => {
  it('should return false by default', () => {
    expect(hasInlineScripts()).toBe(false);
  });
});

describe('getURLsToPreFetch', () => {
  it('should return React URLs for react type', () => {
    const urls = getURLsToPreFetch('react');
    expect(urls).toContain(REACT_CDN.url);
    expect(urls).toContain(REACT_DOM_CDN.url);
    expect(urls).toContain(TAILWIND_CDN.url);
  });

  it('should return markdown URLs for markdown type', () => {
    const urls = getURLsToPreFetch('markdown');
    expect(urls).toContain(MARKED_CDN.url);
    expect(urls).toContain(TAILWIND_CDN.url);
  });

  it('should return all URLs for auto type', () => {
    const urls = getURLsToPreFetch('auto');
    expect(urls).toContain(REACT_CDN.url);
    expect(urls).toContain(REACT_DOM_CDN.url);
    expect(urls).toContain(MARKED_CDN.url);
    expect(urls).toContain(HANDLEBARS_CDN.url);
    expect(urls).toContain(TAILWIND_CDN.url);
  });
});

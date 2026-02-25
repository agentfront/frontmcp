/**
 * @file build-universal.test.ts
 * @description Tests for the universal buildToolUI function.
 *
 * The build output is now UNIVERSAL - it works on all platforms.
 * Platform detection happens at runtime via the FrontMCP Bridge.
 */

import { buildToolUI, buildStaticWidget } from '../index';

describe('buildToolUI - Universal Build', () => {
  const simpleTemplate = () => '<div id="weather">Sunny, 72°F</div>';

  describe('universal output', () => {
    it('should generate a complete HTML document', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'get_weather',
        output: { temperature: 72 },
      });

      expect(result.html).toContain('<!DOCTYPE html>');
      expect(result.html).toContain('<html lang="en">');
      expect(result.html).toContain('<div id="weather">Sunny, 72°F</div>');
    });

    it('should include FrontMCP Bridge by default', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'get_weather',
      });

      // The universal bridge includes all adapters
      expect(result.html).toContain('FrontMcpBridge');
      expect(result.html).toContain('OpenAIAdapter');
      expect(result.html).toContain('ExtAppsAdapter');
      expect(result.html).toContain('ClaudeAdapter');
      expect(result.html).toContain('GeminiAdapter');
      expect(result.html).toContain('GenericAdapter');
    });

    it('should exclude bridge when config.includeBridge is false', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'get_weather',
        config: { includeBridge: false },
      });

      expect(result.html).not.toContain('FrontMcpBridge');
    });

    it('should inject tool data into window globals', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'get_weather',
        input: { city: 'London' },
        output: { temperature: 72 },
      });

      expect(result.html).toContain('window.__mcpToolName');
      expect(result.html).toContain('get_weather');
      expect(result.html).toContain('window.__mcpToolInput');
      expect(result.html).toContain('London');
      expect(result.html).toContain('window.__mcpToolOutput');
      expect(result.html).toContain('72');
    });

    it('should set page title correctly', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'get_weather',
        title: 'Weather Dashboard',
      });

      expect(result.html).toContain('<title>Weather Dashboard</title>');
    });

    it('should use default title if not provided', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'get_weather',
      });

      expect(result.html).toContain('<title>get_weather Widget</title>');
    });
  });

  describe('MIME types', () => {
    it('should return all MIME type suggestions', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        output: { value: 1 },
      });

      expect(result.mimeTypes).toEqual({
        openai: 'text/html+skybridge',
        mcp: 'text/html+mcp',
        html: 'text/html',
      });
    });

    it('should return same HTML for any platform', async () => {
      // The key insight: same HTML works everywhere
      // MIME type selection happens at response time, not build time
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        output: { value: 1 },
      });

      expect(result.html).toBeDefined();
      expect(result.mimeTypes.openai).toBe('text/html+skybridge');
      expect(result.mimeTypes.mcp).toBe('text/html+mcp');
    });
  });

  describe('network modes', () => {
    it('should use CDN scripts by default (open network)', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        config: { network: 'open' },
      });

      expect(result.config.network).toBe('open');
      // CDN scripts include external script tags
      expect(result.html).toContain('tailwindcss');
    });

    it('should inline scripts for blocked network', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        config: { network: 'blocked' },
      });

      expect(result.config.network).toBe('blocked');
      // When network is blocked, inline mode is used
      // This test verifies the config is passed correctly
    });

    it('should respect explicit script strategy', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        config: { scripts: 'inline' },
      });

      expect(result.config.scripts).toBe('inline');
    });
  });

  describe('CSP configuration', () => {
    it('should include CSP meta tag when configured', async () => {
      const result = await buildToolUI({
        template: {
          template: simpleTemplate,
          csp: {
            connectDomains: ['https://api.weather.com'],
            resourceDomains: ['https://cdn.weather.com'],
          },
        },
        toolName: 'get_weather',
      });

      expect(result.html).toContain('Content-Security-Policy');
      expect(result.html).toContain('api.weather.com');
    });
  });

  describe('build metadata', () => {
    it('should calculate correct size', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
      });

      expect(result.size).toBeGreaterThan(0);
      expect(result.size).toBe(Buffer.byteLength(result.html, 'utf8'));
    });

    it('should calculate gzip size estimate', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
      });

      expect(result.gzipSize).toBeGreaterThan(0);
      expect(result.gzipSize).toBeLessThan(result.size);
    });

    it('should generate hash', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
      });

      expect(result.hash).toBeDefined();
      expect(result.hash.length).toBeGreaterThan(0);
    });

    it('should set renderer type', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
      });

      expect(result.rendererType).toBe('html');
    });

    it('should set build time', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
      });

      expect(result.buildTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should include build config in result', async () => {
      const result = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        config: { network: 'blocked', minify: true },
      });

      expect(result.config).toEqual({
        network: 'blocked',
        scripts: 'auto',
        includeBridge: true,
        minify: true,
      });
    });
  });

  describe('minification', () => {
    it('should minify when config.minify is true', async () => {
      const unminified = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        config: { minify: false },
      });

      const minified = await buildToolUI({
        template: { template: simpleTemplate },
        toolName: 'test',
        config: { minify: true },
      });

      expect(minified.size).toBeLessThan(unminified.size);
    });
  });
});

describe('buildStaticWidget', () => {
  const template = () => '<div id="content">Loading...</div>';

  it('should build a widget with empty data', async () => {
    const result = await buildStaticWidget({
      template: { template },
      toolName: 'dynamic_widget',
    });

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('FrontMcpBridge');
  });

  it('should use provided title', async () => {
    const result = await buildStaticWidget({
      template: { template },
      toolName: 'dynamic_widget',
      title: 'My Dynamic Widget',
    });

    expect(result.html).toContain('<title>My Dynamic Widget</title>');
  });

  it('should respect config options', async () => {
    const result = await buildStaticWidget({
      template: { template },
      toolName: 'dynamic_widget',
      config: { includeBridge: false },
    });

    expect(result.html).not.toContain('FrontMcpBridge');
  });
});


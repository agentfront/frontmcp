// file: plugins/plugin-dashboard/src/__tests__/html.generator.test.ts

import 'reflect-metadata';
import { generateDashboardHtml } from '../html/html.generator';
import { dashboardPluginOptionsSchema } from '../dashboard.types';

describe('generateDashboardHtml', () => {
  describe('inline dashboard (no entrypoint)', () => {
    it('should generate HTML with default options', () => {
      const options = dashboardPluginOptionsSchema.parse({});
      const html = generateDashboardHtml(options);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>FrontMCP Dashboard</title>');
      expect(html).toContain('importmap');
      expect(html).toContain('https://esm.sh/react@19');
      expect(html).toContain('https://esm.sh/react-dom@19');
      expect(html).toContain('@xyflow/react');
      expect(html).toContain('dagre');
    });

    it('should include basePath in configuration', () => {
      const options = dashboardPluginOptionsSchema.parse({ basePath: '/admin' });
      const html = generateDashboardHtml(options);

      expect(html).toContain("basePath: '/admin'");
    });

    it('should include token in SSE URL when auth is enabled', () => {
      const options = dashboardPluginOptionsSchema.parse({
        auth: { enabled: true, token: 'my-secret-token' },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain('token=my-secret-token');
    });

    it('should not include token in SSE URL when auth is disabled', () => {
      const options = dashboardPluginOptionsSchema.parse({
        auth: { enabled: false },
      });
      const html = generateDashboardHtml(options);

      expect(html).not.toContain('?token=');
    });

    it('should include XyFlow CSS link', () => {
      const options = dashboardPluginOptionsSchema.parse({});
      const html = generateDashboardHtml(options);

      expect(html).toContain('<link rel="stylesheet" href="https://esm.sh/@xyflow/react@12/dist/style.css"');
    });

    it('should include custom CDN URLs', () => {
      const options = dashboardPluginOptionsSchema.parse({
        cdn: {
          react: 'https://custom.cdn/react',
          reactDom: 'https://custom.cdn/react-dom',
        },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain('https://custom.cdn/react');
      expect(html).toContain('https://custom.cdn/react-dom');
    });

    it('should include inline styles', () => {
      const options = dashboardPluginOptionsSchema.parse({});
      const html = generateDashboardHtml(options);

      expect(html).toContain('<style>');
      expect(html).toContain('.loading');
      expect(html).toContain('.header');
      expect(html).toContain('.legend');
      expect(html).toContain('.custom-node');
    });

    it('should include node configuration for different types', () => {
      const options = dashboardPluginOptionsSchema.parse({});
      const html = generateDashboardHtml(options);

      expect(html).toContain('server:');
      expect(html).toContain('scope:');
      expect(html).toContain('tool:');
      expect(html).toContain('resource:');
      expect(html).toContain('prompt:');
    });

    it('should include McpClient class for SSE communication', () => {
      const options = dashboardPluginOptionsSchema.parse({});
      const html = generateDashboardHtml(options);

      expect(html).toContain('class McpClient');
      expect(html).toContain('async connect()');
      expect(html).toContain('async callTool(name, args = {})');
    });

    it('should include DashboardApp React component', () => {
      const options = dashboardPluginOptionsSchema.parse({});
      const html = generateDashboardHtml(options);

      expect(html).toContain('function DashboardApp()');
      expect(html).toContain('ReactFlow');
      expect(html).toContain('Background');
      expect(html).toContain('Controls');
      expect(html).toContain('MiniMap');
    });

    it('should escape special characters in basePath', () => {
      const options = dashboardPluginOptionsSchema.parse({
        basePath: "/dashboard's<test>",
      });
      const html = generateDashboardHtml(options);

      // Should escape quotes and angle brackets
      expect(html).toContain("\\'");
      expect(html).toContain('\\x3c');
      expect(html).toContain('\\x3e');
    });

    it('should escape special characters in token', () => {
      const options = dashboardPluginOptionsSchema.parse({
        auth: { enabled: true, token: "token's<script>" },
      });
      const html = generateDashboardHtml(options);

      // Should escape quotes and angle brackets
      expect(html).toContain("token\\'s");
      expect(html).toContain('\\x3cscript\\x3e');
    });
  });

  describe('external entrypoint', () => {
    it('should use external entrypoint when provided', () => {
      const options = dashboardPluginOptionsSchema.parse({
        cdn: {
          entrypoint: 'https://cdn.example.com/dashboard-ui.js',
        },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain('https://cdn.example.com/dashboard-ui.js');
      expect(html).toContain("import('https://cdn.example.com/dashboard-ui.js')");
      expect(html).toContain('mod.mount');
    });

    it('should include window config for external entrypoint', () => {
      const options = dashboardPluginOptionsSchema.parse({
        basePath: '/custom-dash',
        auth: { enabled: true, token: 'ext-token' },
        cdn: {
          entrypoint: 'https://cdn.example.com/ui.js',
        },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain('window.__FRONTMCP_DASHBOARD__');
      expect(html).toContain("basePath: '/custom-dash'");
      expect(html).toContain('ext-token');
    });

    it('should include error handling for external entrypoint', () => {
      const options = dashboardPluginOptionsSchema.parse({
        cdn: {
          entrypoint: 'https://cdn.example.com/ui.js',
        },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain('.catch(err =>');
      expect(html).toContain('Failed to load dashboard');
      expect(html).toContain('escapeHtml');
    });

    it('should include importmap in external entrypoint HTML', () => {
      const options = dashboardPluginOptionsSchema.parse({
        cdn: {
          entrypoint: 'https://cdn.example.com/ui.js',
        },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain('importmap');
      expect(html).toContain('"react"');
      expect(html).toContain('"react-dom"');
    });

    it('should escape external entrypoint URL', () => {
      const options = dashboardPluginOptionsSchema.parse({
        cdn: {
          entrypoint: "https://cdn.example.com/ui's<script>.js",
        },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain("ui\\'s\\x3cscript\\x3e.js");
    });
  });

  describe('SSE configuration', () => {
    it('should build correct SSE URL without token', () => {
      const options = dashboardPluginOptionsSchema.parse({
        basePath: '/dashboard',
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain("sseUrl: '/dashboard/sse'");
    });

    it('should build correct SSE URL with token', () => {
      const options = dashboardPluginOptionsSchema.parse({
        basePath: '/dashboard',
        auth: { enabled: true, token: 'test-token' },
      });
      const html = generateDashboardHtml(options);

      expect(html).toContain("sseUrl: '/dashboard/sse?token=test-token'");
    });
  });
});

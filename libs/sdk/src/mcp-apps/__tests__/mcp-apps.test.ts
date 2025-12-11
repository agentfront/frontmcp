/**
 * @file mcp-apps.test.ts
 * @description Tests for MCP Apps specification support.
 */

import {
  MCP_APPS_MIME_TYPE,
  MCP_APPS_PROTOCOL_VERSION,
  MCP_APPS_METHODS,
  type McpAppsCSP,
  type McpAppsHostContext,
  type UIResource,
  type McpUiInitializeParams,
  type McpUiInitializeResult,
} from '../types';

import {
  McpAppsCSPSchema,
  McpAppsHostContextSchema,
  UIResourceSchema,
  McpUiInitializeParamsSchema,
  McpUiInitializeResultSchema,
  isValidUIResourceUri,
  isValidProtocolVersion,
  parseUIResource,
  parseHostContext,
} from '../schemas';

import {
  buildCSPHeader,
  buildCSPDirectives,
  buildSandboxAttribute,
  buildCSPMetaTag,
  isDomainAllowed,
  mergeCSP,
  parseCSPHeader,
  DEFAULT_CSP_DIRECTIVES,
  SANDBOX_PERMISSIONS,
} from '../csp';

import {
  generateMcpAppsTemplate,
  wrapInMcpAppsTemplate,
  createSimpleMcpAppsTemplate,
  extractBodyContent,
} from '../template';

describe('MCP Apps - Types and Constants', () => {
  it('should have correct MIME type', () => {
    expect(MCP_APPS_MIME_TYPE).toBe('text/html+mcp');
  });

  it('should have correct protocol version format', () => {
    expect(MCP_APPS_PROTOCOL_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should export all required method names', () => {
    expect(MCP_APPS_METHODS.INITIALIZE).toBe('ui/initialize');
    expect(MCP_APPS_METHODS.INITIALIZED).toBe('ui/notifications/initialized');
    expect(MCP_APPS_METHODS.TOOL_INPUT).toBe('ui/notifications/tool-input');
    expect(MCP_APPS_METHODS.TOOL_RESULT).toBe('ui/notifications/tool-result');
    expect(MCP_APPS_METHODS.OPEN_LINK).toBe('ui/open-link');
    expect(MCP_APPS_METHODS.MESSAGE).toBe('ui/message');
  });
});

describe('MCP Apps - Schemas', () => {
  describe('McpAppsCSPSchema', () => {
    it('should validate valid CSP', () => {
      const csp: McpAppsCSP = {
        connectDomains: ['https://api.example.com'],
        resourceDomains: ['https://cdn.example.com'],
      };
      const result = McpAppsCSPSchema.safeParse(csp);
      expect(result.success).toBe(true);
    });

    it('should validate empty CSP', () => {
      const result = McpAppsCSPSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should reject invalid domain URLs', () => {
      const result = McpAppsCSPSchema.safeParse({
        connectDomains: ['not-a-url'],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('McpAppsHostContextSchema', () => {
    it('should validate full host context', () => {
      const context: McpAppsHostContext = {
        theme: 'dark',
        displayMode: 'fullscreen',
        locale: 'en-US',
        timeZone: 'America/New_York',
        platform: 'web',
        viewport: { width: 800, height: 600 },
        deviceCapabilities: { touch: true, hover: false },
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        toolInfo: {
          id: 'req-123',
          tool: { name: 'get_weather', description: 'Get weather data' },
        },
      };
      const result = McpAppsHostContextSchema.safeParse(context);
      expect(result.success).toBe(true);
    });

    it('should validate minimal host context', () => {
      const result = McpAppsHostContextSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe('UIResourceSchema', () => {
    it('should validate valid UI resource', () => {
      const resource: UIResource = {
        uri: 'ui://tools/weather/widget',
        name: 'Weather Widget',
        mimeType: 'text/html+mcp',
      };
      const result = UIResourceSchema.safeParse(resource);
      expect(result.success).toBe(true);
    });

    it('should reject non-ui:// URI', () => {
      const result = UIResourceSchema.safeParse({
        uri: 'https://example.com/widget',
        name: 'Widget',
        mimeType: 'text/html+mcp',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('isValidUIResourceUri', () => {
    it('should accept valid ui:// URIs', () => {
      expect(isValidUIResourceUri('ui://tools/weather')).toBe(true);
      expect(isValidUIResourceUri('ui://widget/test.html')).toBe(true);
    });

    it('should reject invalid URIs', () => {
      expect(isValidUIResourceUri('https://example.com')).toBe(false);
      expect(isValidUIResourceUri('ui://')).toBe(false);
      expect(isValidUIResourceUri('')).toBe(false);
    });
  });

  describe('isValidProtocolVersion', () => {
    it('should accept valid date format versions', () => {
      expect(isValidProtocolVersion('2025-01-01')).toBe(true);
      expect(isValidProtocolVersion('2024-12-31')).toBe(true);
    });

    it('should reject invalid formats', () => {
      expect(isValidProtocolVersion('1.0.0')).toBe(false);
      expect(isValidProtocolVersion('2025-1-1')).toBe(false);
    });
  });

  describe('parseUIResource', () => {
    it('should parse valid resource', () => {
      const data = {
        uri: 'ui://test/widget',
        name: 'Test',
        mimeType: 'text/html+mcp',
      };
      const result = parseUIResource(data);
      expect(result).not.toBeNull();
      expect(result?.uri).toBe('ui://test/widget');
    });

    it('should return null for invalid resource', () => {
      const result = parseUIResource({ invalid: 'data' });
      expect(result).toBeNull();
    });
  });

  describe('parseHostContext', () => {
    it('should parse valid context', () => {
      const data = { theme: 'light' };
      const result = parseHostContext(data);
      expect(result).not.toBeNull();
      expect(result?.theme).toBe('light');
    });

    it('should return null for invalid context', () => {
      const result = parseHostContext({ theme: 'invalid' });
      expect(result).toBeNull();
    });
  });
});

describe('MCP Apps - CSP Generation', () => {
  describe('buildCSPHeader', () => {
    it('should generate default CSP without config', () => {
      const header = buildCSPHeader();
      expect(header).toContain("default-src 'none'");
      expect(header).toContain("script-src 'self' 'unsafe-inline'");
    });

    it('should include connect domains', () => {
      const header = buildCSPHeader({
        connectDomains: ['https://api.example.com'],
      });
      expect(header).toContain('connect-src');
      expect(header).toContain('https://api.example.com');
    });

    it('should include resource domains in multiple directives', () => {
      const header = buildCSPHeader({
        resourceDomains: ['https://cdn.example.com'],
      });
      expect(header).toContain('https://cdn.example.com');
      // Resource domains should appear in script-src, style-src, img-src, font-src
    });
  });

  describe('buildCSPDirectives', () => {
    it('should return array of directives', () => {
      const directives = buildCSPDirectives();
      expect(Array.isArray(directives)).toBe(true);
      expect(directives.length).toBeGreaterThan(0);
    });

    it('should deduplicate values', () => {
      const directives = buildCSPDirectives({
        resourceDomains: ['https://cdn.example.com', 'https://cdn.example.com'],
      });
      const scriptSrc = directives.find((d) => d.name === 'script-src');
      const cdnCount = scriptSrc?.values.filter((v) => v === 'https://cdn.example.com').length;
      expect(cdnCount).toBe(1);
    });
  });

  describe('buildSandboxAttribute', () => {
    it('should include base permissions', () => {
      const sandbox = buildSandboxAttribute();
      expect(sandbox).toContain('allow-scripts');
      expect(sandbox).toContain('allow-same-origin');
    });

    it('should include optional permissions', () => {
      const sandbox = buildSandboxAttribute({
        allowForms: true,
        allowPopups: true,
        allowPopupsToEscapeSandbox: true,
      });
      expect(sandbox).toContain('allow-forms');
      expect(sandbox).toContain('allow-popups');
      expect(sandbox).toContain('allow-popups-to-escape-sandbox');
    });
  });

  describe('buildCSPMetaTag', () => {
    it('should generate valid meta tag', () => {
      const meta = buildCSPMetaTag();
      expect(meta).toMatch(/^<meta http-equiv="Content-Security-Policy" content=".*">$/);
    });

    it('should escape special characters', () => {
      const meta = buildCSPMetaTag({ connectDomains: ['https://api.example.com'] });
      expect(meta).not.toContain('<script>');
    });
  });

  describe('isDomainAllowed', () => {
    it('should allow matching domain', () => {
      const csp: McpAppsCSP = { connectDomains: ['https://api.example.com'] };
      expect(isDomainAllowed('https://api.example.com/endpoint', csp, 'connect')).toBe(true);
    });

    it('should reject non-matching domain', () => {
      const csp: McpAppsCSP = { connectDomains: ['https://api.example.com'] };
      expect(isDomainAllowed('https://other.com', csp, 'connect')).toBe(false);
    });

    it('should return false for undefined CSP', () => {
      expect(isDomainAllowed('https://any.com', undefined, 'connect')).toBe(false);
    });
  });

  describe('mergeCSP', () => {
    it('should merge connect domains', () => {
      const base: McpAppsCSP = { connectDomains: ['https://a.com'] };
      const override: McpAppsCSP = { connectDomains: ['https://b.com'] };
      const merged = mergeCSP(base, override);
      expect(merged.connectDomains).toContain('https://a.com');
      expect(merged.connectDomains).toContain('https://b.com');
    });

    it('should deduplicate domains', () => {
      const base: McpAppsCSP = { connectDomains: ['https://a.com'] };
      const override: McpAppsCSP = { connectDomains: ['https://a.com'] };
      const merged = mergeCSP(base, override);
      expect(merged.connectDomains?.length).toBe(1);
    });
  });

  describe('parseCSPHeader', () => {
    it('should parse connect domains', () => {
      const header = "connect-src 'self' https://api.example.com";
      const csp = parseCSPHeader(header);
      expect(csp.connectDomains).toContain('https://api.example.com');
    });

    it('should handle empty header', () => {
      const csp = parseCSPHeader('');
      expect(csp.connectDomains).toBeUndefined();
    });
  });

  describe('DEFAULT_CSP_DIRECTIVES', () => {
    it('should have default-src none', () => {
      const defaultSrc = DEFAULT_CSP_DIRECTIVES.find((d) => d.name === 'default-src');
      expect(defaultSrc?.values).toContain("'none'");
    });
  });

  describe('SANDBOX_PERMISSIONS', () => {
    it('should include required permissions', () => {
      expect(SANDBOX_PERMISSIONS).toContain('allow-scripts');
      expect(SANDBOX_PERMISSIONS).toContain('allow-same-origin');
    });
  });
});

describe('MCP Apps - Template Generation', () => {
  describe('generateMcpAppsTemplate', () => {
    it('should generate valid HTML5 document', () => {
      const html = generateMcpAppsTemplate({
        title: 'Test Widget',
        bodyContent: '<div id="app">Hello</div>',
      });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<title>Test Widget</title>');
      expect(html).toContain('<div id="app">Hello</div>');
    });

    it('should include CSP meta tag', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        csp: { connectDomains: ['https://api.example.com'] },
      });
      expect(html).toContain('Content-Security-Policy');
    });

    it('should include MCP Apps version meta', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
      });
      expect(html).toContain('mcp-apps-version');
      expect(html).toContain(MCP_APPS_PROTOCOL_VERSION);
    });

    it('should include bridge script by default', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
      });
      expect(html).toContain('window.mcpBridge');
    });

    it('should allow disabling bridge', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        includeBridge: false,
      });
      expect(html).not.toContain('window.mcpBridge');
    });

    it('should set theme data attribute', () => {
      const darkHtml = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        theme: 'dark',
      });
      expect(darkHtml).toContain('data-theme="dark"');

      const lightHtml = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        theme: 'light',
      });
      expect(lightHtml).toContain('data-theme="light"');
    });

    it('should embed tool info as data attributes', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        toolInfo: { tool: { name: 'test_tool' } },
      });
      expect(html).toContain('data-mcp-tool=');
    });

    it('should embed input as data attribute', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        input: { city: 'London' },
      });
      expect(html).toContain('data-mcp-input=');
    });

    it('should embed output as data attribute', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div>Content</div>',
        output: { temperature: 72 },
      });
      expect(html).toContain('data-mcp-output=');
    });
  });

  describe('wrapInMcpAppsTemplate', () => {
    it('should wrap HTML content', () => {
      const html = wrapInMcpAppsTemplate('<div>My Content</div>', { title: 'Wrapped' });
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<div>My Content</div>');
    });
  });

  describe('createSimpleMcpAppsTemplate', () => {
    it('should create simple template', () => {
      const html = createSimpleMcpAppsTemplate('Hello World', 'Simple');
      expect(html).toContain('Hello World');
      expect(html).toContain('<title>Simple</title>');
    });
  });

  describe('extractBodyContent', () => {
    it('should extract body content', () => {
      const html = generateMcpAppsTemplate({
        bodyContent: '<div id="unique-content">Test</div>',
      });
      const body = extractBodyContent(html);
      expect(body).toContain('unique-content');
    });

    it('should return null for invalid HTML', () => {
      const body = extractBodyContent('not html');
      expect(body).toBeNull();
    });
  });
});

describe('MCP Apps - Protocol Messages', () => {
  describe('McpUiInitializeParamsSchema', () => {
    it('should validate initialize params', () => {
      const params: McpUiInitializeParams = {
        protocolVersion: '2025-01-01',
        capabilities: {
          messages: ['ui/notifications/tool-input'],
        },
      };
      const result = McpUiInitializeParamsSchema.safeParse(params);
      expect(result.success).toBe(true);
    });
  });

  describe('McpUiInitializeResultSchema', () => {
    it('should validate initialize result', () => {
      const result: McpUiInitializeResult = {
        protocolVersion: '2025-01-01',
        capabilities: {},
        hostContext: {
          theme: 'light',
          viewport: { width: 800, height: 600 },
        },
      };
      const parsed = McpUiInitializeResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });
  });
});

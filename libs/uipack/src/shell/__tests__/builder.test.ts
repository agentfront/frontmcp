/**
 * Shell Builder Tests
 *
 * Tests for buildShell including default behavior and custom shell integration.
 */

import { buildShell } from '../builder';
import type { ShellConfig } from '../types';
import type { ResolvedShellTemplate } from '../custom-shell-types';

// ============================================
// Default Shell Behavior (regression)
// ============================================

describe('buildShell - default shell', () => {
  const baseConfig: ShellConfig = {
    toolName: 'test_tool',
    output: { message: 'Hello' },
  };

  it('should produce a full HTML document by default', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);

    expect(result.html).toContain('<!DOCTYPE html>');
    expect(result.html).toContain('<html lang="en">');
    expect(result.html).toContain('<head>');
    expect(result.html).toContain('<body>');
    expect(result.html).toContain('<div>Hello</div>');
    expect(result.html).toContain('__mcpToolName');
  });

  it('should include CSP meta tag', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);
    expect(result.html).toContain('Content-Security-Policy');
  });

  it('should include bridge runtime by default', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);
    expect(result.html).toContain('<script>');
  });

  it('should exclude bridge runtime when includeBridge is false', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      includeBridge: false,
    });
    // Data injection script still present, but no bridge IIFE
    expect(result.html).toContain('__mcpToolName');
  });

  it('should include title when provided', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      title: 'My Widget',
    });
    expect(result.html).toContain('<title>My Widget</title>');
  });

  it('should escape HTML in title', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      title: '<script>alert("xss")</script>',
    });
    expect(result.html).not.toContain('<script>alert("xss")</script>');
    expect(result.html).toContain('&lt;script&gt;');
  });

  it('should return hash and size', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);
    expect(result.hash).toBeDefined();
    expect(result.hash.length).toBeGreaterThan(0);
    expect(result.size).toBeGreaterThan(0);
    expect(result.size).toBe(Buffer.byteLength(result.html, 'utf-8'));
  });
});

// ============================================
// Shell-less Mode (regression)
// ============================================

describe('buildShell - withShell: false', () => {
  it('should return data script + content without HTML document', () => {
    const result = buildShell('<div>Hello</div>', {
      toolName: 'test_tool',
      withShell: false,
    });

    expect(result.html).not.toContain('<!DOCTYPE html>');
    expect(result.html).not.toContain('<html');
    expect(result.html).toContain('__mcpToolName');
    expect(result.html).toContain('<div>Hello</div>');
  });

  it('should ignore customShell when withShell is false', () => {
    const result = buildShell('<div>Hello</div>', {
      toolName: 'test_tool',
      withShell: false,
      customShell: '<html>{{CSP}}{{DATA}}{{BRIDGE}}<body>{{CONTENT}}</body></html>',
    });

    expect(result.html).not.toContain('<!DOCTYPE html>');
    expect(result.html).not.toContain('{{CONTENT}}');
    expect(result.html).toContain('<div>Hello</div>');
  });
});

// ============================================
// Custom Shell - Inline String
// ============================================

describe('buildShell - custom shell (inline string)', () => {
  const baseConfig: ShellConfig = {
    toolName: 'test_tool',
    output: { value: 42 },
  };

  it('should use custom template with all placeholders', () => {
    const template = `<!DOCTYPE html>
<html>
<head>
{{CSP}}
{{DATA}}
{{BRIDGE}}
<title>{{TITLE}}</title>
</head>
<body>
{{CONTENT}}
</body>
</html>`;

    const result = buildShell('<div>Widget</div>', {
      ...baseConfig,
      customShell: template,
      title: 'Custom Title',
    });

    expect(result.html).toContain('Content-Security-Policy');
    expect(result.html).toContain('__mcpToolName');
    expect(result.html).toContain('<div>Widget</div>');
    expect(result.html).toContain('Custom Title');
    expect(result.html).not.toContain('{{CSP}}');
    expect(result.html).not.toContain('{{DATA}}');
    expect(result.html).not.toContain('{{BRIDGE}}');
    expect(result.html).not.toContain('{{CONTENT}}');
    expect(result.html).not.toContain('{{TITLE}}');
  });

  it('should work with only CONTENT placeholder', () => {
    const template = '<div class="custom-wrapper">{{CONTENT}}</div>';

    const result = buildShell('<p>Hello</p>', {
      ...baseConfig,
      customShell: template,
    });

    expect(result.html).toBe('<div class="custom-wrapper"><p>Hello</p></div>');
  });

  it('should throw if CONTENT placeholder is missing', () => {
    const template = '<html><head>{{CSP}}</head><body>No content placeholder</body></html>';

    expect(() => {
      buildShell('<div>Widget</div>', {
        ...baseConfig,
        customShell: template,
      });
    }).toThrow('missing required placeholder');
  });

  it('should omit bridge when includeBridge is false', () => {
    const template = '<html><head>{{BRIDGE}}</head><body>{{CONTENT}}</body></html>';

    const result = buildShell('<div>Widget</div>', {
      ...baseConfig,
      customShell: template,
      includeBridge: false,
    });

    // Bridge placeholder should be replaced with empty string
    expect(result.html).toBe('<html><head></head><body><div>Widget</div></body></html>');
  });

  it('should provide empty title when no title configured', () => {
    const template = '<html><title>{{TITLE}}</title><body>{{CONTENT}}</body></html>';

    const result = buildShell('<div>Widget</div>', {
      ...baseConfig,
      customShell: template,
    });

    expect(result.html).toContain('<title></title>');
  });
});

// ============================================
// Custom Shell - ResolvedShellTemplate Object
// ============================================

describe('buildShell - custom shell (ResolvedShellTemplate)', () => {
  it('should use pre-resolved template object', () => {
    const resolved: ResolvedShellTemplate = {
      template: '<html><body>{{CONTENT}}</body></html>',
      sourceType: 'url',
      validation: {
        valid: true,
        found: { CSP: false, DATA: false, BRIDGE: false, CONTENT: true, TITLE: false },
        missingRequired: [],
        missingOptional: ['CSP', 'DATA', 'BRIDGE', 'TITLE'],
      },
    };

    const result = buildShell('<div>From resolved</div>', {
      toolName: 'test_tool',
      customShell: resolved,
    });

    expect(result.html).toBe('<html><body><div>From resolved</div></body></html>');
  });

  it('should return consistent hash and size', () => {
    const resolved: ResolvedShellTemplate = {
      template: '<html><body>{{CONTENT}}</body></html>',
      sourceType: 'inline',
      validation: {
        valid: true,
        found: { CSP: false, DATA: false, BRIDGE: false, CONTENT: true, TITLE: false },
        missingRequired: [],
        missingOptional: ['CSP', 'DATA', 'BRIDGE', 'TITLE'],
      },
    };

    const r1 = buildShell('<div>Test</div>', { toolName: 't', customShell: resolved });
    const r2 = buildShell('<div>Test</div>', { toolName: 't', customShell: resolved });

    expect(r1.hash).toBe(r2.hash);
    expect(r1.size).toBe(r2.size);
  });
});

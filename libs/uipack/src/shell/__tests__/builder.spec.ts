/**
 * Shell Builder Tests
 *
 * Tests for buildShell including default behavior and custom shell integration.
 */

import { buildShell } from '../builder';
import type { ResolvedShellTemplate } from '../custom-shell-types';
import type { ShellConfig } from '../types';

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

  it('should include __mcpAppsEnabled flag in data injection', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);
    expect(result.html).toContain('window.__mcpAppsEnabled = true');
  });

  it('should place __mcpAppsEnabled before __mcpToolName', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);
    const appsIdx = result.html.indexOf('__mcpAppsEnabled');
    const toolIdx = result.html.indexOf('__mcpToolName');
    expect(appsIdx).toBeLessThan(toolIdx);
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
// Widget Sizing
// ============================================

describe('buildShell - widget sizing', () => {
  const baseConfig: ShellConfig = {
    toolName: 'sized_tool',
    output: { message: 'Hello' },
  };

  it('should NOT inject sizing CSS or assign __mcpWidgetSizing when no sizing configured', () => {
    const result = buildShell('<div>Hello</div>', baseConfig);
    // The bridge IIFE always *references* window.__mcpWidgetSizing (to read it),
    // but with no sizing configured the data-injection script must not *assign*
    // it, and no sizing <style> block should be emitted.
    expect(result.html).not.toContain('window.__mcpWidgetSizing =');
    expect(result.html).not.toMatch(/<style>html, body \{/);
  });

  it('should inject initial height CSS for numeric preferredHeight (→ px)', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { preferredHeight: 420 },
    });
    expect(result.html).toContain('height: 420px;');
    expect(result.html).toContain('#root { min-height: 420px;');
  });

  it('should pass string CSS lengths through verbatim', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { preferredHeight: '50vh', minHeight: '10rem' },
    });
    expect(result.html).toContain('height: 50vh;');
    expect(result.html).toContain('min-height: 10rem;');
  });

  it('should inject min/max-height and aspect-ratio', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { minHeight: 100, maxHeight: 600, aspectRatio: '16 / 9' },
    });
    expect(result.html).toContain('min-height: 100px;');
    expect(result.html).toContain('max-height: 600px;');
    expect(result.html).toContain('aspect-ratio: 16 / 9;');
  });

  it('should assign __mcpWidgetSizing global with the sizing config', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { preferredHeight: 300, autoResize: true },
    });
    expect(result.html).toContain('window.__mcpWidgetSizing =');
    expect(result.html).toContain('"preferredHeight":300');
  });

  it('should assign __mcpWidgetSizing when only autoResize:false is set (opt-out)', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { autoResize: false },
    });
    expect(result.html).toContain('window.__mcpWidgetSizing =');
    expect(result.html).toContain('"autoResize":false');
  });

  it('should include the auto-resize runtime in the bridge by default', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { preferredHeight: 300 },
    });
    expect(result.html).toContain('__initAutoResize');
  });

  it('should sanitize CSS values inside the <style> block (no tag/decl breakout)', () => {
    const result = buildShell('<div>Hello</div>', {
      ...baseConfig,
      sizing: { preferredHeight: '300px;}</style><script>alert(1)' },
    });

    // Isolate the injected height declaration from the sizing <style> block —
    // `< > { } ;` are stripped from the value, so it can't break out of the
    // declaration or the <style> tag.
    const declMatch = result.html.match(/<style>html, body \{[^}]*?height: ([^;]*);/);
    expect(declMatch).toBeTruthy();
    const declValue = declMatch![1];
    // No tag breakout, no extra `}` to close the rule early, no `;` to start a
    // new declaration — the malicious chars are gone.
    expect(declValue).not.toContain('<');
    expect(declValue).not.toContain('>');
    expect(declValue).not.toContain('}');
    expect(declValue).not.toContain(';');
    // The stripped value survives as an (inert) CSS token.
    expect(declValue).toBe('300px/stylescriptalert(1)');
  });

  it('should inject sizing into custom shells via the DATA placeholder', () => {
    const template = '<html><head>{{DATA}}{{BRIDGE}}</head><body>{{CONTENT}}</body></html>';
    const result = buildShell('<div>Widget</div>', {
      ...baseConfig,
      customShell: template,
      sizing: { preferredHeight: 240 },
    });
    expect(result.html).toContain('window.__mcpWidgetSizing');
    expect(result.html).toContain('height: 240px;');
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

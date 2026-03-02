/**
 * Custom Shell Types Tests
 *
 * Tests for type guards and constants.
 */

import {
  SHELL_PLACEHOLDER_NAMES,
  SHELL_PLACEHOLDERS,
  REQUIRED_PLACEHOLDERS,
  OPTIONAL_PLACEHOLDERS,
  isInlineShellSource,
  isUrlShellSource,
  isNpmShellSource,
} from '../custom-shell-types';
import type { InlineShellSource, UrlShellSource, NpmShellSource, CustomShellSource } from '../custom-shell-types';

// ============================================
// Constants
// ============================================

describe('SHELL_PLACEHOLDER_NAMES', () => {
  it('should contain all 5 placeholder names', () => {
    expect(SHELL_PLACEHOLDER_NAMES).toEqual(['CSP', 'DATA', 'BRIDGE', 'CONTENT', 'TITLE']);
  });
});

describe('SHELL_PLACEHOLDERS', () => {
  it('should map names to {{NAME}} tokens', () => {
    expect(SHELL_PLACEHOLDERS.CSP).toBe('{{CSP}}');
    expect(SHELL_PLACEHOLDERS.DATA).toBe('{{DATA}}');
    expect(SHELL_PLACEHOLDERS.BRIDGE).toBe('{{BRIDGE}}');
    expect(SHELL_PLACEHOLDERS.CONTENT).toBe('{{CONTENT}}');
    expect(SHELL_PLACEHOLDERS.TITLE).toBe('{{TITLE}}');
  });
});

describe('REQUIRED_PLACEHOLDERS', () => {
  it('should only require CONTENT', () => {
    expect(REQUIRED_PLACEHOLDERS).toEqual(['CONTENT']);
  });
});

describe('OPTIONAL_PLACEHOLDERS', () => {
  it('should include CSP, DATA, BRIDGE, TITLE', () => {
    expect(OPTIONAL_PLACEHOLDERS).toEqual(['CSP', 'DATA', 'BRIDGE', 'TITLE']);
  });
});

// ============================================
// Type Guards
// ============================================

describe('isInlineShellSource', () => {
  it('should return true for InlineShellSource', () => {
    const source: InlineShellSource = { inline: '<html>{{CONTENT}}</html>' };
    expect(isInlineShellSource(source)).toBe(true);
  });

  it('should return false for UrlShellSource', () => {
    const source: UrlShellSource = { url: 'https://example.com/shell.html' };
    expect(isInlineShellSource(source)).toBe(false);
  });

  it('should return false for NpmShellSource', () => {
    const source: NpmShellSource = { npm: 'my-shell-pkg' };
    expect(isInlineShellSource(source)).toBe(false);
  });
});

describe('isUrlShellSource', () => {
  it('should return true for UrlShellSource', () => {
    const source: UrlShellSource = { url: 'https://example.com/shell.html' };
    expect(isUrlShellSource(source)).toBe(true);
  });

  it('should return true for UrlShellSource with timeout', () => {
    const source: UrlShellSource = { url: 'https://example.com/shell.html', timeout: 5000 };
    expect(isUrlShellSource(source)).toBe(true);
  });

  it('should return false for InlineShellSource', () => {
    const source: InlineShellSource = { inline: '<html></html>' };
    expect(isUrlShellSource(source)).toBe(false);
  });

  it('should return false for NpmShellSource', () => {
    const source: NpmShellSource = { npm: 'my-pkg' };
    expect(isUrlShellSource(source)).toBe(false);
  });
});

describe('isNpmShellSource', () => {
  it('should return true for NpmShellSource', () => {
    const source: NpmShellSource = { npm: '@acme/shell-template' };
    expect(isNpmShellSource(source)).toBe(true);
  });

  it('should return true for NpmShellSource with version and exportName', () => {
    const source: NpmShellSource = { npm: 'my-shell', exportName: 'darkShell', version: '2.0.0' };
    expect(isNpmShellSource(source)).toBe(true);
  });

  it('should return false for InlineShellSource', () => {
    const source: InlineShellSource = { inline: '' };
    expect(isNpmShellSource(source)).toBe(false);
  });

  it('should return false for UrlShellSource', () => {
    const source: UrlShellSource = { url: 'https://example.com' };
    expect(isNpmShellSource(source)).toBe(false);
  });
});

describe('discriminated type guard flow', () => {
  it('should correctly narrow custom shell source union', () => {
    const sources: CustomShellSource[] = [
      { inline: '<html>{{CONTENT}}</html>' },
      { url: 'https://example.com/shell.html' },
      { npm: '@acme/shell' },
    ];

    const results = sources.map((s) => {
      if (isInlineShellSource(s)) return 'inline';
      if (isUrlShellSource(s)) return 'url';
      if (isNpmShellSource(s)) return 'npm';
      return 'unknown';
    });

    expect(results).toEqual(['inline', 'url', 'npm']);
  });
});

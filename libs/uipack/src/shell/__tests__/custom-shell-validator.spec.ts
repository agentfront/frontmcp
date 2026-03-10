/**
 * Custom Shell Validator Tests
 */

import { validateShellTemplate } from '../custom-shell-validator';

describe('validateShellTemplate', () => {
  it('should be valid when all placeholders are present', () => {
    const template =
      '<html><head>{{CSP}}{{DATA}}{{BRIDGE}}</head><body><title>{{TITLE}}</title>{{CONTENT}}</body></html>';
    const result = validateShellTemplate(template);

    expect(result.valid).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual([]);
    expect(result.found).toEqual({
      CSP: true,
      DATA: true,
      BRIDGE: true,
      CONTENT: true,
      TITLE: true,
    });
  });

  it('should be valid with only CONTENT (required)', () => {
    const template = '<html><body>{{CONTENT}}</body></html>';
    const result = validateShellTemplate(template);

    expect(result.valid).toBe(true);
    expect(result.missingRequired).toEqual([]);
    expect(result.missingOptional).toEqual(['CSP', 'DATA', 'BRIDGE', 'TITLE']);
  });

  it('should be invalid when CONTENT is missing', () => {
    const template = '<html><head>{{CSP}}{{DATA}}</head><body></body></html>';
    const result = validateShellTemplate(template);

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual(['CONTENT']);
  });

  it('should be invalid for empty template', () => {
    const result = validateShellTemplate('');

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual(['CONTENT']);
    expect(result.missingOptional).toEqual(['CSP', 'DATA', 'BRIDGE', 'TITLE']);
  });

  it('should not match partial placeholder names', () => {
    const template = '{{CONT}} {{CONTENTS}} {CONTENT} {{content}} {{CONTENT}}';
    const result = validateShellTemplate(template);

    // Only exact {{CONTENT}} should match
    expect(result.valid).toBe(true);
    expect(result.found.CONTENT).toBe(true);
  });

  it('should detect each placeholder independently', () => {
    const template = '{{CSP}}{{CONTENT}}';
    const result = validateShellTemplate(template);

    expect(result.found.CSP).toBe(true);
    expect(result.found.CONTENT).toBe(true);
    expect(result.found.DATA).toBe(false);
    expect(result.found.BRIDGE).toBe(false);
    expect(result.found.TITLE).toBe(false);
  });

  it('should handle multiple occurrences of same placeholder', () => {
    const template = '{{CONTENT}} more stuff {{CONTENT}}';
    const result = validateShellTemplate(template);

    expect(result.valid).toBe(true);
    expect(result.found.CONTENT).toBe(true);
  });

  it('should handle template with only optional placeholders', () => {
    const template = '{{CSP}}{{DATA}}{{BRIDGE}}{{TITLE}}';
    const result = validateShellTemplate(template);

    expect(result.valid).toBe(false);
    expect(result.missingRequired).toEqual(['CONTENT']);
    expect(result.missingOptional).toEqual([]);
  });
});

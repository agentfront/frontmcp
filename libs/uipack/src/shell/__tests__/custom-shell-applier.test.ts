/**
 * Custom Shell Applier Tests
 */

import { applyShellTemplate } from '../custom-shell-applier';
import type { ShellPlaceholderValues } from '../custom-shell-types';

const defaultValues: ShellPlaceholderValues = {
  csp: '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'">',
  data: '<script>window.__FMCP_DATA__={}</script>',
  bridge: '<script>(function(){/* bridge */})()</script>',
  content: '<div id="root">Hello</div>',
  title: 'My Tool',
};

describe('applyShellTemplate', () => {
  it('should replace all placeholders', () => {
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

    const result = applyShellTemplate(template, defaultValues);

    expect(result).toContain(defaultValues.csp);
    expect(result).toContain(defaultValues.data);
    expect(result).toContain(defaultValues.bridge);
    expect(result).toContain(defaultValues.content);
    expect(result).toContain(`<title>${defaultValues.title}</title>`);
    expect(result).not.toContain('{{CSP}}');
    expect(result).not.toContain('{{DATA}}');
    expect(result).not.toContain('{{BRIDGE}}');
    expect(result).not.toContain('{{CONTENT}}');
    expect(result).not.toContain('{{TITLE}}');
  });

  it('should handle empty values', () => {
    const template = '<html><head>{{CSP}}{{DATA}}{{BRIDGE}}</head><body>{{CONTENT}}</body></html>';
    const emptyValues: ShellPlaceholderValues = {
      csp: '',
      data: '',
      bridge: '',
      content: '',
      title: '',
    };

    const result = applyShellTemplate(template, emptyValues);
    expect(result).toBe('<html><head></head><body></body></html>');
  });

  it('should not re-scan injected content for placeholders', () => {
    const template = '<html><head>{{CSP}}</head><body>{{CONTENT}}</body></html>';
    const values: ShellPlaceholderValues = {
      csp: '<!-- safe -->',
      data: '',
      bridge: '',
      // Content itself contains {{CSP}} — should NOT be replaced again
      content: '<div>User typed {{CSP}} literally</div>',
      title: '',
    };

    const result = applyShellTemplate(template, values);

    // The {{CSP}} in user content should remain as-is because CSP was already replaced
    expect(result).toContain('<!-- safe -->');
    expect(result).toContain('User typed {{CSP}} literally');
  });

  it('should replace multiple occurrences of the same placeholder', () => {
    const template = '{{CONTENT}} separator {{CONTENT}}';
    const values: ShellPlaceholderValues = {
      csp: '',
      data: '',
      bridge: '',
      content: 'HELLO',
      title: '',
    };

    const result = applyShellTemplate(template, values);
    expect(result).toBe('HELLO separator HELLO');
  });

  it('should handle template with no placeholders', () => {
    const template = '<html><body>Static content</body></html>';
    const result = applyShellTemplate(template, defaultValues);
    expect(result).toBe('<html><body>Static content</body></html>');
  });

  it('should handle template with only CONTENT placeholder', () => {
    const template = '<div>{{CONTENT}}</div>';
    const result = applyShellTemplate(template, defaultValues);
    expect(result).toBe(`<div>${defaultValues.content}</div>`);
  });

  it('should preserve template structure around placeholders', () => {
    const template = '  {{CSP}}\n  {{DATA}}\n  {{BRIDGE}}\n{{CONTENT}}';
    const values: ShellPlaceholderValues = {
      csp: 'A',
      data: 'B',
      bridge: 'C',
      content: 'D',
      title: '',
    };

    const result = applyShellTemplate(template, values);
    expect(result).toBe('  A\n  B\n  C\nD');
  });
});

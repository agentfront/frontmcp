/**
 * @jest-environment jsdom
 */
/**
 * Placeholder values are inserted verbatim, in one pass (GHSA-rhr9-vhpf-jqp7).
 *
 * `applyShellTemplate` ran one `replaceAll` per placeholder. That had two effects on values
 * that carry tool input and output (`{{DATA}}` holds them as JSON, `{{CONTENT}}` holds the
 * template result):
 *
 * - A value inserted early was scanned again by every later placeholder, so a `{{CONTENT}}`
 *   or `{{BRIDGE}}` inside tool output was replaced by that fragment inside a script string.
 * - A string replacement honours `$&`, `$'` and `` $` ``, so `$'` in tool output pasted the rest
 *   of the template, including its raw `</script>`, into the data script.
 */
import { buildShell } from '../builder';
import { applyShellTemplate } from '../custom-shell-applier';
import type { ShellPlaceholderValues } from '../custom-shell-types';

const EMPTY_VALUES: ShellPlaceholderValues = { csp: '', data: '', bridge: '', content: '', title: '' };

describe('applyShellTemplate — single-pass verbatim insertion (GHSA-rhr9-vhpf-jqp7)', () => {
  it("inserts `$'` literally instead of the text after the placeholder", () => {
    const html = applyShellTemplate('<head>{{DATA}}</head><body>{{CONTENT}}</body>', {
      ...EMPTY_VALUES,
      data: `<script>x="$'"</script>`,
      content: 'C',
    });

    expect(html).toBe(`<head><script>x="$'"</script></head><body>C</body>`);
  });

  it('inserts `$&` and `$`` literally', () => {
    const html = applyShellTemplate('A{{DATA}}B', { ...EMPTY_VALUES, data: '[$&][$`]' });

    expect(html).toBe('A[$&][$`]B');
  });

  it('does not replace a placeholder that appears inside an earlier value', () => {
    const html = applyShellTemplate('<head>{{DATA}}</head><body>{{CONTENT}}</body>', {
      ...EMPTY_VALUES,
      data: '<script>x="{{CONTENT}}"</script>',
      content: '<p>content</p>',
    });

    expect(html).toBe('<head><script>x="{{CONTENT}}"</script></head><body><p>content</p></body>');
  });

  it('does not replace a placeholder that appears inside a later value', () => {
    const html = applyShellTemplate('<title>{{TITLE}}</title><body>{{CONTENT}}</body>', {
      ...EMPTY_VALUES,
      content: 'typed {{TITLE}} literally',
      title: 'Tool',
    });

    expect(html).toBe('<title>Tool</title><body>typed {{TITLE}} literally</body>');
  });

  it('keeps tool output inside the data script of a custom shell', () => {
    const { html } = buildShell('<div id="root"></div>', {
      toolName: 'get_note',
      output: { note: "$'", comment: '<img src=x onerror=window.__shell_xss=1>' },
      customShell: '<!DOCTYPE html><html><head>{{DATA}}{{BRIDGE}}</head><body>{{CONTENT}}</body></html>',
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.querySelectorAll('img, [onerror]')).toHaveLength(0);
    expect(doc.getElementById('root')).not.toBeNull();
  });
});

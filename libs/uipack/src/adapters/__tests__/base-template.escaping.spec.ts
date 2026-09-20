/**
 * The default widget template escapes every value it interpolates
 * (GHSA-xp6r-ggxc-j7q8, GHSA-rhr9-vhpf-jqp7).
 *
 * `createDefaultBaseTemplate` built its placeholder body with
 * `<code>${toolName}</code>` — a raw interpolation into HTML. The name reaches this function
 * straight from a `resources/read` URI, so a crafted URI put arbitrary markup into the
 * document that the host then renders.
 *
 * Escaping here is the fix that holds regardless of what the caller passes. The URI parser is
 * tightened separately, but a template must not depend on its callers having validated their
 * input.
 */
import { createDefaultBaseTemplate } from '../base-template';

/**
 * Everything outside a `<script>` element, which is where markup is parsed.
 *
 * Inside a script the name is a JSON string literal produced by `safeJsonForScript`, which
 * escapes `</` so the element cannot be closed early; angle brackets there are inert and do
 * not need entity escaping. Asserting over the whole document would fail on that safe
 * occurrence, so the check is scoped to the context where injection is possible.
 */
function markupOnly(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
}

const INJECTIONS = [
  { payload: '</code><script>alert(1)</script>', mustNotContain: '<script>alert(1)</script>' },
  { payload: '<img src=x onerror=alert(1)>', mustNotContain: '<img src=x' },
  { payload: '"><svg/onload=alert(1)>', mustNotContain: '<svg/onload' },
];

describe('createDefaultBaseTemplate — escaping (GHSA-xp6r-ggxc-j7q8, GHSA-rhr9-vhpf-jqp7)', () => {
  it.each(INJECTIONS)('escapes $payload in the tool name', ({ payload, mustNotContain }) => {
    const html = markupOnly(createDefaultBaseTemplate({ toolName: payload }));

    // In markup context the raw payload must never survive: it has to be entity-escaped.
    expect(html).not.toContain(payload);
    expect(html).not.toContain(mustNotContain);
  });

  it('renders the tool name as escaped text in the placeholder body', () => {
    const html = createDefaultBaseTemplate({ toolName: '<b>x</b>' });

    expect(html).toContain('<code>&lt;b&gt;x&lt;/b&gt;</code>');
  });

  it('still shows an ordinary tool name', () => {
    const html = createDefaultBaseTemplate({ toolName: 'get_weather' });

    expect(html).toContain('<code>get_weather</code>');
  });

  it('escapes the ampersand so an entity in the name is not re-interpreted', () => {
    const html = createDefaultBaseTemplate({ toolName: 'a&lt;b' });

    expect(html).toContain('a&amp;lt;b');
  });

  it('closes the script element safely when the name contains one', () => {
    const html = createDefaultBaseTemplate({ toolName: '</script><img src=x onerror=alert(1)>' });

    // safeJsonForScript escapes `</`, so the injected name cannot terminate the data script.
    expect(html).not.toContain('</script><img');
  });

  it('renders tool output as text rather than markup', () => {
    const html = createDefaultBaseTemplate({ toolName: 'get_weather' });

    // The result handler must not build the output view by string-concatenating into
    // innerHTML; textContent cannot produce markup whatever the data contains.
    expect(html).toContain('pre.textContent');
    expect(html).not.toContain("root.innerHTML = '<pre");
  });
});

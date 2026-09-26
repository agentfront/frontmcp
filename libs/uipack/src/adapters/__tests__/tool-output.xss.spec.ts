/**
 * @jest-environment jsdom
 */
/**
 * Tool output cannot inject markup through the auto-detected content renderers
 * (GHSA-rhr9-vhpf-jqp7).
 *
 * `renderToolTemplate` auto-detects what an HTML template function returned. Two branches
 * interpolated that value without escaping it for the context it landed in:
 *
 * - A string starting with `JVBERi` (base64 of `%PDF`) was treated as a PDF and embedded as
 *   `const base64 = ${JSON.stringify(value)};` inside a `<script type="module">`. JSON does not
 *   escape `</script>`, so the value closed the script and the rest was parsed as markup.
 * - Any other object was written as `<pre>${JSON.stringify(value)}</pre>`, so a string field
 *   containing `</pre><img …>` became an element.
 *
 * Each case parses the generated document with a real HTML parser and asserts that no element
 * or event-handler attribute from the payload exists, rather than matching substrings.
 */
import { createTemplateHelpers } from '../../shell/data-injector';
import { safeJsonForScript } from '../../utils';
import { buildPdfHtml, detectContentType, renderToolTemplate } from '../index';

const PDF_BREAKOUT = 'JVBERi</script><img src=x onerror="window.__uipack_xss=1">';
const PRE_BREAKOUT = { title: '</pre><img src=x onerror="window.__fallback_xss=1">' };
const LEGIT_PDF_BASE64 = btoa(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);

function renderOutput(output: unknown): Document {
  const { html } = renderToolTemplate({
    toolName: 'get_document',
    input: {},
    output,
    template: (ctx: { output: unknown }) => ctx.output,
  });
  return new DOMParser().parseFromString(html, 'text/html');
}

function injectedElements(doc: Document): Element[] {
  return Array.from(doc.querySelectorAll('img, svg, iframe, [onerror], [onload]'));
}

function pdfModuleScript(doc: Document): string {
  const script = Array.from(doc.querySelectorAll('script[type="module"]')).find((element) =>
    (element.textContent ?? '').includes('pdfjsLib'),
  );
  return script?.textContent ?? '';
}

function embeddedBase64(scriptText: string): unknown {
  const literal = scriptText.match(/const base64 = (.*);/)?.[1];
  return literal === undefined ? undefined : JSON.parse(literal);
}

describe('tool output rendering — script and markup breakout (GHSA-rhr9-vhpf-jqp7)', () => {
  describe('PDF branch', () => {
    it('does not let the reporter payload create an element through renderToolTemplate', () => {
      const doc = renderOutput(PDF_BREAKOUT);

      expect(injectedElements(doc)).toEqual([]);
    });

    it('does not treat a value that is not base64 as a PDF', () => {
      expect(detectContentType(PDF_BREAKOUT)).not.toBe('pdf');
      expect(detectContentType('JVBERi0xLjQK not base64')).not.toBe('pdf');
    });

    it('keeps the value inside the script when buildPdfHtml is called directly', () => {
      const doc = new DOMParser().parseFromString(buildPdfHtml(PDF_BREAKOUT), 'text/html');

      expect(injectedElements(doc)).toEqual([]);
      expect(embeddedBase64(pdfModuleScript(doc))).toBe(PDF_BREAKOUT);
    });

    it('still renders a real base64 PDF with the data intact', () => {
      expect(detectContentType(LEGIT_PDF_BASE64)).toBe('pdf');

      const doc = renderOutput(LEGIT_PDF_BASE64);

      expect(embeddedBase64(pdfModuleScript(doc))).toBe(LEGIT_PDF_BASE64);
    });

    it('accepts base64 wrapped across lines', () => {
      const wrapped = `${LEGIT_PDF_BASE64.slice(0, 40)}\r\n${LEGIT_PDF_BASE64.slice(40)}\n`;

      expect(detectContentType(wrapped)).toBe('pdf');
      expect(embeddedBase64(pdfModuleScript(renderOutput(wrapped)))).toBe(wrapped);
    });
  });

  describe('object fallback', () => {
    it('does not let a string field close the <pre> and create an element', () => {
      const doc = renderOutput(PRE_BREAKOUT);

      expect(injectedElements(doc)).toEqual([]);
    });

    it('shows the object as JSON text', () => {
      const doc = renderOutput(PRE_BREAKOUT);
      const pre = doc.querySelector('body pre');

      expect(JSON.parse(pre?.textContent ?? '')).toEqual(PRE_BREAKOUT);
    });
  });

  describe('chart and mermaid branches', () => {
    it('keeps chart data inside its script', () => {
      const chart = { type: 'bar', data: { labels: ['</script><img src=x onerror=window.__chart_xss=1>'] } };
      const doc = renderOutput(chart);

      expect(injectedElements(doc)).toEqual([]);
      expect(doc.querySelector('canvas#chart')).not.toBeNull();
    });

    it('renders mermaid source as text inside the diagram element', () => {
      const diagram = 'graph TD; A["</pre><img src=x onerror=window.__mermaid_xss=1>"]';
      const doc = renderOutput(diagram);

      expect(injectedElements(doc)).toEqual([]);
      expect(doc.querySelector('pre.mermaid')?.textContent).toBe(diagram);
    });
  });

  describe('plain text results', () => {
    it('renders a string without a closing bracket as text, not as an unterminated tag', () => {
      const doc = renderOutput('<img src=x onerror=window.__text_xss=1 ');

      expect(injectedElements(doc)).toEqual([]);
      expect(doc.body.textContent).toContain('<img src=x onerror=window.__text_xss=1');
    });

    it('still renders an ordinary text result', () => {
      const doc = renderOutput('Temperature: 18 degrees');

      expect(doc.body.textContent).toContain('Temperature: 18 degrees');
    });
  });

  describe('safeJsonForScript', () => {
    it('escapes every character that can change how a script element is parsed', () => {
      const serialized = safeJsonForScript({ value: '<!--<script></script>&\u2028\u2029>' });

      for (const character of ['<', '>', '&', '\u2028', '\u2029']) {
        expect(serialized).not.toContain(character);
      }
      expect(serialized).toBe(
        '{"value":"\\u003c!--\\u003cscript\\u003e\\u003c/script\\u003e\\u0026\\u2028\\u2029\\u003e"}',
      );
    });

    it('round-trips to the original value', () => {
      const value = { html: '</script><img src=x onerror=alert(1)>', text: 'a & b', lines: 'x\u2028y\u2029z' };

      expect(JSON.parse(safeJsonForScript(value))).toEqual(value);
    });

    it.each([
      [undefined, 'null'],
      [() => undefined, 'null'],
      [{ big: BigInt(10) }, '{"big":"10"}'],
    ])('serializes %p as %s', (value, expected) => {
      expect(safeJsonForScript(value)).toBe(expected);
    });

    it('returns an error object when the value cannot be serialized', () => {
      const circular: Record<string, unknown> = {};
      circular['self'] = circular;

      expect(safeJsonForScript(circular)).toBe('{"error":"Value could not be serialized"}');
    });

    it('backs the jsonEmbed template helper', () => {
      const embedded = createTemplateHelpers().jsonEmbed({ html: '<!--</script><img src=x onerror=alert(1)>' });

      expect(embedded).not.toContain('<');
      expect(JSON.parse(embedded)).toEqual({ html: '<!--</script><img src=x onerror=alert(1)>' });
    });

    it('cannot end the script it is embedded in', () => {
      const html = `<script>window.__data = ${safeJsonForScript({ payload: PDF_BREAKOUT })};</script>`;
      const doc = new DOMParser().parseFromString(html, 'text/html');

      expect(doc.querySelectorAll('script')).toHaveLength(1);
      expect(injectedElements(doc)).toEqual([]);
    });
  });
});

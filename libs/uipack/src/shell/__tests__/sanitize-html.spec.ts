import { DEFAULT_MAX_MARKUP_LENGTH, describeContentSecurityProblems, sanitizeHtml } from '../sanitize-html';

describe('sanitizeHtml', () => {
  describe('by default', () => {
    it.each([
      ['a script element', '<p>a</p><script>alert(1)</script><p>b</p>', '<p>a</p><p>b</p>'],
      ['a script element in any case', '<ScRiPt src="https://x.example/a.js"></sCrIpT>ok', 'ok'],
      ['a script that is never closed', '<p>a</p><script>alert(1)', '<p>a</p>'],
      ['an SVG script', '<svg><script>alert(1)</script></svg>', '<svg></svg>'],
      ['event handlers', '<img src="a.png" onerror="alert(1)" OnLoad=x>', '<img src="a.png">'],
      ['a handler after a slash', '<img/src/onerror=alert(1)>', '<img src>'],
      ['a handler on body', '<body onload="alert(1)">x</body>', '<body>x</body>'],
      ['srcdoc', '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '<iframe></iframe>'],
      [
        'object, embed and applet tags',
        '<object data="x.swf"><p>fallback</p></object><embed src="y">',
        '<p>fallback</p>',
      ],
      ['base and meta', '<base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=x">ok', 'ok'],
      ['comments', 'a<!-- <script>alert(1)</script> -->b<!-->c<!--->d', 'abcd'],
      ['doctypes and processing instructions', '<!DOCTYPE html><?xml version="1.0"?>ok', 'ok'],
      [
        'SVG animations, which can set an href later',
        '<svg><a><set attributeName="hr&#101;f" to="javascript:alert(1)"/><animate attributeName="href" values="https://x&#59javascript:alert(1)"/><animateMotion /><animateTransform /><text>x</text></a></svg>',
        '<svg><a><text>x</text></a></svg>',
      ],
      [
        'the tool-call attributes the bridge clicks',
        '<button data-tool-call="delete_project" data-tool-args=\'{"confirm":true}\'>Show</button>',
        '<button>Show</button>',
      ],
      [
        "a stylesheet's @import",
        '<style>@import url(https://evil.example/x.css); @IMPORT "y.css" screen; @\\69mport url(z); p { color: red }</style>',
        '<style>      p { color: red }</style>',
      ],
      [
        'a cross-origin stylesheet link',
        '<link rel="stylesheet" href="https://evil.example/x.css"><link rel="Alternate StyleSheet" href="//evil.example/y.css"><link rel="stylesheet" href="/own.css">',
        '<link rel="stylesheet" href="/own.css">',
      ],
      [
        'fixed and sticky positioning from a style attribute',
        '<div style="color: red; position: FIXED !important; p\\osition:f\\69xed; position:/**/sticky; --p:fixed; position: var(--p); top: 0">x</div>',
        '<div style="color: red; --p:fixed; top: 0">x</div>',
      ],
    ])('removes %s', (_name, input, expected) => {
      expect(sanitizeHtml(input)).toBe(expected);
    });

    it.each([
      ['javascript:', '<a href="javascript:alert(1)">x</a>'],
      ['vbscript:', '<a href="vbscript:msgbox(1)">x</a>'],
      ['data:', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
      ['an upper-case scheme', '<a href="JAVASCRIPT:alert(1)">x</a>'],
      ['leading whitespace and controls', '<a href=" \u0001javascript:alert(1)">x</a>'],
      ['a tab inside the scheme', '<a href="java\tscript:alert(1)">x</a>'],
      ['decimal references', '<a href="&#106;&#97;vascript:alert(1)">x</a>'],
      ['hex references without semicolons', '<a href="&#x6A&#x61vascript:alert(1)">x</a>'],
      ['a referenced tab', '<a href="jav&#x09;ascript:alert(1)">x</a>'],
      ['named references', '<a href="javas&Tab;cript&colon;alert(1)">x</a>'],
      ['a leading non-breaking space', '<a href="&nbsp;javascript:alert(1)">x</a>'],
      ['a decimal reference without its semicolon', '<a href="javascript&#58alert(1)">x</a>'],
      ['an unquoted value', '<a href=javascript:alert(1)>x</a>'],
    ])('removes a link with %s', (_name, input) => {
      expect(sanitizeHtml(input)).toBe('<a>x</a>');
    });

    it.each([
      ['form action', '<form action="javascript:alert(1)"></form>', '<form></form>'],
      ['button formaction', '<button formaction="javascript:alert(1)">b</button>', '<button>b</button>'],
      ['iframe src', '<iframe src="javascript:alert(1)"></iframe>', '<iframe></iframe>'],
      [
        'SVG xlink:href',
        '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
        '<svg><a><text>x</text></a></svg>',
      ],
      ['MathML href', '<math href="javascript:alert(1)"><mi>x</mi></math>', '<math><mi>x</mi></math>'],
      ['an SVG use of a data URL', '<svg><use href="data:image/svg+xml,x"/></svg>', '<svg><use /></svg>'],
      ['an image data URL that is SVG', '<img src="data:image/svg+xml,<svg onload=alert(1)>">', '<img>'],
      ['a srcset entry', '<img srcset="a.png 1x, javascript:alert(1) 2x">', '<img>'],
    ])('removes an unsafe URL in %s', (_name, input, expected) => {
      expect(sanitizeHtml(input)).toBe(expected);
    });

    it.each([
      [
        'http(s) and mailto links',
        '<a href="https://example.com/a?b=1&amp;c=2">x</a><a href="mailto:a@example.com">m</a>',
      ],
      [
        'relative links',
        '<a href="/docs">a</a><a href="#top">b</a><a href="page.html?q=1">c</a><a href="//cdn.example.com/x">d</a>',
      ],
      ['raster data images', '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">'],
      [
        'an SVG drawing',
        '<svg viewBox="0 0 10 10"><circle r="4" fill="red" /><path d="M0 0L10 10" stroke="blue" /></svg>',
      ],
      [
        'a same-origin stylesheet and positioned elements',
        '<link rel="stylesheet" href="css/w.css"><div style="position: absolute; top: 0">x</div>',
      ],
      ['CSS nesting', '<style>.card { & .title { color: red } &:hover { color: blue } }</style>'],
      ['styles', '<style>.card > p { color: red; }</style><p style="margin: 0">x</p>'],
      ['data and aria attributes', '<div data-id="7" aria-label="Card" class="a b">x</div>'],
      ['custom elements', '<my-widget data-x="1">x</my-widget>'],
      ['text with entities', '<p>a &lt; b &amp; c &gt; d &copy;</p>'],
    ])('keeps %s', (_name, input) => {
      expect(sanitizeHtml(input)).toBe(input);
    });
  });

  describe('writes back what it checked', () => {
    it('escapes a "<" that opens no tag', () => {
      expect(sanitizeHtml('1 < 2 and 3 <4 <')).toBe('1 &lt; 2 and 3 &lt;4 &lt;');
    });

    it('quotes attribute values and escapes their markup characters', () => {
      expect(sanitizeHtml(`<p title=a"b data-x='<b>'>x</p>`)).toBe('<p title="a&quot;b" data-x="&lt;b&gt;">x</p>');
    });

    it('decodes each attribute value once and writes back exactly what it checked', () => {
      expect(sanitizeHtml('<p title="&copy; 2026 &amp; &notit; &#x1F600;" data-x="&lt;b&gt;">x</p>')).toBe(
        '<p title="\u00a9 2026 &amp; &amp;notit; \u{1F600}" data-x="&lt;b&gt;">x</p>',
      );
      expect(sanitizeHtml('<a href="https://example.com/?a=1&amp;b=2&c=3">x</a>')).toBe(
        '<a href="https://example.com/?a=1&amp;b=2&amp;c=3">x</a>',
      );
      expect(sanitizeHtml('<p title="a\u0000b">x</p>')).toBe('<p title="a\ufffdb">x</p>');
    });

    it('writes the text of a style element so that HTML and SVG read the same CSS', () => {
      expect(sanitizeHtml('<svg><style>&#64;import url(x); a::after { content: "&lt;" }</style></svg>')).toBe(
        '<svg><style>\\26 #64;import url(x); a::after { content: "\\26 lt;" }</style></svg>',
      );
    });

    it('gives the same output when it sanitizes its own output, dotted capital I included', () => {
      for (const markup of [
        '<title>\u0130\u0130\u0130</title><b onclick=x>bold</b>',
        '<xmp src=x>\\3c\u0130<STYLE href></input&<div></mi>',
        '<style>@import x;</style><a href="&amp;x">y</a>',
      ]) {
        const once = sanitizeHtml(markup);
        expect(sanitizeHtml(once)).toBe(once);
      }
    });

    it('keeps the first of duplicate attributes, as the browser does', () => {
      expect(sanitizeHtml('<a href="/safe" href="javascript:alert(1)">x</a>')).toBe('<a href="/safe">x</a>');
    });

    it('drops attribute names that would not read back the same', () => {
      expect(sanitizeHtml('<p "onclick"=x =y>x</p>')).toBe('<p>x</p>');
    });

    it('drops a tag the markup ends inside, with the rest, as the browser does', () => {
      expect(sanitizeHtml('<p>a</p><img src="x" onerror="alert(1)"')).toBe('<p>a</p>');
    });

    it('reads noscript as a page with scripting does, so an end tag inside an attribute ends it', () => {
      expect(sanitizeHtml('<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>')).toBe(
        '<noscript></noscript><img src="x">"></p></noscript>',
      );
    });

    it('keeps no "<" in the text of style, title and textarea, whatever namespace reads them', () => {
      expect(sanitizeHtml('<svg><style><img src=x onerror=alert(1)></style></svg>')).toBe(
        '<svg><style>\\3c img src=x onerror=alert(1)></style></svg>',
      );
      expect(sanitizeHtml('<svg><title><img src=x onerror=alert(1)></title></svg>')).toBe(
        '<svg><title>&lt;img src=x onerror=alert(1)></title></svg>',
      );
      expect(sanitizeHtml('<textarea></textarea><script>x</script>')).toBe('<textarea></textarea>');
    });

    it('ends raw text only at its own end tag', () => {
      expect(sanitizeHtml('<textarea></textareax><b></textarea >x')).toBe(
        '<textarea>&lt;/textareax>&lt;b></textarea>x',
      );
    });

    it('drops what iframe, noembed and noframes hold', () => {
      expect(sanitizeHtml('<iframe><img src=x onerror=alert(1)></iframe><noembed>a</noembed>')).toBe(
        '<iframe></iframe><noembed></noembed>',
      );
    });

    it('turns plaintext into escaped text', () => {
      expect(sanitizeHtml('<p>a</p><plaintext><script>alert(1)</script>')).toBe(
        '<p>a</p>&lt;script>alert(1)&lt;/script>',
      );
    });

    it('keeps self-closing SVG elements self-closed', () => {
      expect(sanitizeHtml('<svg><path d="M0 0"/><rect/></svg>')).toBe('<svg><path d="M0 0" /><rect /></svg>');
    });
  });

  describe('with its flags', () => {
    const markup = '<div onclick="go()"><script>init()</script><a href="javascript:void(0)">x</a></div>';

    it('keeps inline scripts and handlers with allowInlineScripts, and still removes unsafe links', () => {
      expect(sanitizeHtml(markup, { allowInlineScripts: true })).toBe(
        '<div onclick="go()"><script>init()</script><a>x</a></div>',
      );
    });

    it('keeps no script loaded from elsewhere with allowInlineScripts', () => {
      expect(
        sanitizeHtml(
          '<script src="https://cdn.jsdelivr.net/npm/x"></script><svg><script href="/x.js"></script></svg>' +
            '<object data="/x"></object><embed src="/y"><iframe srcdoc="<script>x()</script>"></iframe>',
          { allowInlineScripts: true },
        ),
      ).toBe('<svg></svg><iframe></iframe>');
    });

    it('keeps any link but data: in navigation attributes only with allowUnsafeLinks', () => {
      const policy = { allowUnsafeLinks: true };
      expect(sanitizeHtml(markup, policy)).toBe('<div><a href="javascript:void(0)">x</a></div>');
      expect(
        sanitizeHtml(
          '<area href="tel:1"><form action="javascript:go()"><button formaction="x-app:go">b</button></form>',
          policy,
        ),
      ).toBe('<area href="tel:1"><form action="javascript:go()"><button formaction="x-app:go">b</button></form>');
      expect(
        sanitizeHtml(
          '<iframe src="javascript:go()"></iframe><iframe src="data:text/html,x"></iframe><img src="javascript:x">' +
            '<a href="data:text/html,x">d</a><svg><use href="javascript:x" /></svg>',
          policy,
        ),
      ).toBe('<iframe></iframe><iframe></iframe><img><a>d</a><svg><use /></svg>');
    });

    it('keeps data-tool-call and data-tool-args only with allowToolCallAttributes', () => {
      const button = '<button data-tool-call="refresh" data-tool-args="{&quot;id&quot;:1}">Refresh</button>';
      expect(sanitizeHtml(button)).toBe('<button>Refresh</button>');
      expect(sanitizeHtml('<b DATA-Tool-Call="x">y</b>')).toBe('<b>y</b>');
      expect(sanitizeHtml(button, { allowToolCallAttributes: true })).toBe(button);
    });

    it('returns the markup unchanged with bypassSanitization', () => {
      const raw = '<!-- c --><img src=x onerror=alert(1)><script>x</script>';
      expect(sanitizeHtml(raw, { bypassSanitization: true })).toBe(raw);
    });
  });

  describe('its policy and its limit', () => {
    it.each([
      ['a string', 'false', '`ui.contentSecurity` must be an object of flags, and it is string "false".'],
      ['null', null, '`ui.contentSecurity` must be an object of flags, and it is null.'],
      ['an array', [], '`ui.contentSecurity` must be an object of flags, and it is [].'],
      [
        'a flag that is a string',
        { allowInlineScripts: 'false' },
        '`ui.contentSecurity.allowInlineScripts` must be true or false, and it is string "false".',
      ],
      ['a mistyped flag', { allowInlineScript: true }, '`ui.contentSecurity` has no `allowInlineScript` option;'],
      [
        'a limit that is not a positive integer',
        { maxMarkupLength: 0 },
        '`ui.contentSecurity.maxMarkupLength` must be a positive integer, and it is number 0.',
      ],
    ])('refuses %s', (_name, policy, problem) => {
      expect(describeContentSecurityProblems(policy)).toEqual([expect.stringContaining(problem)]);
      expect(() => sanitizeHtml('<p>x</p>', policy as never)).toThrow(TypeError);
    });

    it('accepts an empty object and booleans', () => {
      expect(describeContentSecurityProblems({})).toEqual([]);
      expect(
        describeContentSecurityProblems({
          allowUnsafeLinks: false,
          allowInlineScripts: true,
          allowToolCallAttributes: false,
          bypassSanitization: false,
          maxMarkupLength: 10,
        }),
      ).toEqual([]);
    });

    it('refuses markup longer than its limit instead of returning it unsanitized', () => {
      expect(DEFAULT_MAX_MARKUP_LENGTH).toBe(2 * 1024 * 1024);
      expect(() => sanitizeHtml('<p>12345</p>', { maxMarkupLength: 11 })).toThrow(RangeError);
      expect(() => sanitizeHtml('x'.repeat(DEFAULT_MAX_MARKUP_LENGTH + 1))).toThrow(
        `The markup is ${DEFAULT_MAX_MARKUP_LENGTH + 1} characters, over the ${DEFAULT_MAX_MARKUP_LENGTH}`,
      );
      expect(sanitizeHtml('<p>1234</p>', { maxMarkupLength: 11 })).toBe('<p>1234</p>');
    });
  });
});

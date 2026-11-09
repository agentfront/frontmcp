import { sanitizeHtml } from '../sanitize-html';

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
      ['an unknown named reference before the path', '<a href="java&nbsp;script:alert(1)">x</a>'],
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
      [
        'an SVG animation of an href',
        '<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>',
        '<svg><a><animate attributeName="href" /></a></svg>',
      ],
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
        'an SVG with its animations',
        '<svg viewBox="0 0 10 10"><circle r="4"><animate attributeName="r" values="1;4" dur="1s" /></circle></svg>',
      ],
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

    it('keeps scripts and handlers with allowInlineScripts, and still removes unsafe links', () => {
      expect(sanitizeHtml(markup, { allowInlineScripts: true })).toBe(
        '<div onclick="go()"><script>init()</script><a>x</a></div>',
      );
      expect(
        sanitizeHtml('<object data="/x"></object><iframe srcdoc="a"></iframe>', { allowInlineScripts: true }),
      ).toBe('<object data="/x"></object><iframe srcdoc="a"></iframe>');
    });

    it('keeps every link with allowUnsafeLinks, and still removes scripts', () => {
      expect(sanitizeHtml(markup, { allowUnsafeLinks: true })).toBe('<div><a href="javascript:void(0)">x</a></div>');
    });

    it('returns the markup unchanged with bypassSanitization', () => {
      const raw = '<!-- c --><img src=x onerror=alert(1)><script>x</script>';
      expect(sanitizeHtml(raw, { bypassSanitization: true })).toBe(raw);
    });
  });
});

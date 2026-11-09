/**
 * The sanitizer's output, read by a spec-compliant HTML parser (jsdom's parse5), the way a widget's
 * page reads it: no payload may leave a script, an event handler or a script URL in the document,
 * and sanitizing what the parser serializes back must find nothing more to remove.
 */

import { JSDOM, VirtualConsole } from 'jsdom';

import { sanitizeHtml } from '../sanitize-html';

const PAYLOADS = [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><style><img src=x onerror=alert(1)></style></svg>',
  '<svg></p><style><a id="</style><img src=1 onerror=alert(1)>">',
  '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
  '<math><mi><mglyph><svg><mtext><textarea><path id="</textarea><img onerror=alert(1) src=1>">',
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<a href="javas&Tab;cript&colon;alert(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="\u0000javascript:alert(1)">x</a>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button>x</button></form>',
  '<button formaction="javascript:alert(1)">x</button>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
  '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
  '<math href="javascript:alert(1)">x</math>',
  '<body onload=alert(1)>',
  '<details open ontoggle=alert(1)>',
  '<img src="x" onerror="alert(1)"//',
  '<img/src/onerror=alert(1)>',
  '<img src=x one rror=alert(1) onerror =alert(1)>',
  '<<script>alert(1)//<</script>',
  '<scr<script>ipt>alert(1)</script>',
  '<!--<img src=x onerror=alert(1)>-->',
  '<!--><img src=x onerror=alert(1)>-->',
  '<!-- --!><img src=x onerror=alert(1)>-->',
  '<![CDATA[<img src=x onerror=alert(1)>]]>',
  '<?xml <img src=x onerror=alert(1)>?>',
  '<title><img src=x onerror=alert(1)></title>',
  '<textarea><img src=x onerror=alert(1)></textarea>',
  '<xmp><img src=x onerror=alert(1)></xmp>',
  '<plaintext><img src=x onerror=alert(1)>',
  '<template><img src=x onerror=alert(1)></template>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="javascript:alert(1)//">',
  '<link rel="stylesheet" href="javascript:alert(1)">',
  '<img srcset="x 1x, javascript:alert(1) 2x">',
  '<video poster="javascript:alert(1)"></video>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  '<div style="x" onclick="alert(1)" onclick="y">x</div>',
  '<select><style></select><img src=x onerror=alert(1)></style>',
];

const URL_ATTRIBUTES = [
  'href',
  'xlink:href',
  'src',
  'action',
  'formaction',
  'poster',
  'data',
  'srcset',
  'to',
  'values',
];

function findings(markup: string): string[] {
  const { document } = new JSDOM(`<!DOCTYPE html><html><head></head><body>${markup}</body></html>`, {
    virtualConsole: new VirtualConsole(),
  }).window;
  const found: string[] = [];
  const visit = (root: ParentNode) => {
    for (const element of Array.from(root.querySelectorAll('*'))) {
      const name = element.localName;
      if (['script', 'object', 'embed', 'applet', 'base', 'meta'].includes(name)) found.push(`<${name}>`);
      for (const attribute of Array.from(element.attributes)) {
        const attributeName = attribute.name.toLowerCase();
        if (attributeName.startsWith('on') || attributeName === 'srcdoc') found.push(`${name}[${attributeName}]`);
        if (
          URL_ATTRIBUTES.includes(attributeName) &&
          /(java|vb)script:|data:(?!image\/(png|gif|jpeg|webp|avif))/i.test(attribute.value.replace(/[\u0000- ]/g, ''))
        ) {
          found.push(`${name}[${attributeName}=${attribute.value}]`);
        }
      }
      if (name === 'template') visit((element as HTMLTemplateElement).content);
    }
  };
  visit(document);
  return found;
}

describe('sanitizeHtml, as a browser parses its output', () => {
  it.each(PAYLOADS)('leaves nothing that runs in %s', (payload) => {
    expect(findings(sanitizeHtml(payload))).toEqual([]);
  });

  it.each(PAYLOADS)('finds nothing more to remove once %s is parsed and serialized again', (payload) => {
    const once = sanitizeHtml(payload);
    const { document } = new JSDOM(`<!DOCTYPE html><body>${once}</body>`, { virtualConsole: new VirtualConsole() })
      .window;
    expect(findings(sanitizeHtml(document.body.innerHTML))).toEqual([]);
  });

  it('confirms the payloads do run unsanitized', () => {
    const unsafe = PAYLOADS.filter((payload) => findings(payload).length > 0);
    expect(unsafe.length).toBeGreaterThan(PAYLOADS.length * 0.75);
  });
});

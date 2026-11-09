/**
 * Widget markup sanitizer for `ui.contentSecurity`.
 *
 * The markup is tokenized the way the HTML tokenizer reads it and written back out: every tag is
 * rebuilt from its parsed name and attributes, text never carries a `<`, and attribute values are
 * quoted. What a browser parses is therefore what the sanitizer checked, even where the input relied
 * on a parse quirk. Comments, doctypes and processing instructions are dropped.
 *
 * @packageDocumentation
 */

import type { UIContentSecurity } from '../types/ui-config';

const WHITESPACE = /[\t\n\f\r ]/;
const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// Written as `name="value"`, a name without these characters, whitespace or controls reads back the same
const ATTRIBUTE_NAME_BREAKERS = /[\s"'<>/=]/;

/** Elements whose content the tokenizer reads as text up to their end tag, and what is kept of it. */
const RAW_TEXT_CONTENT: Record<string, (content: string) => string> = {
  script: (content) => content,
  // `\3c ` keeps CSS meaning and leaves no `<` for an SVG-context parse to read as a tag
  style: (content) => content.replace(/</g, '\\3c '),
  textarea: (content) => content.replace(/</g, '&lt;'),
  title: (content) => content.replace(/</g, '&lt;'),
  xmp: (content) => content.replace(/</g, '&lt;'),
  iframe: () => '',
  noembed: () => '',
  noframes: () => '',
  noscript: () => '',
};

/** Elements that run code or redirect the page however their attributes are set. */
const ALWAYS_DROPPED_TAGS = new Set(['base', 'meta']);
const SCRIPT_LIKE_TAGS = new Set(['object', 'embed', 'applet']);
const ANIMATION_TAGS = new Set(['animate', 'set', 'animatemotion', 'animatetransform', 'animatecolor']);
const ANIMATION_VALUE_ATTRIBUTES = new Set(['to', 'from', 'values', 'by']);

const URL_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'src',
  'action',
  'formaction',
  'poster',
  'background',
  'cite',
  'data',
  'codebase',
  'classid',
  'archive',
  'longdesc',
  'lowsrc',
  'dynsrc',
  'manifest',
  'icon',
  'profile',
]);
const URL_LIST_ATTRIBUTES = new Set(['srcset', 'imagesrcset', 'ping']);

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
const RASTER_IMAGE_DATA_URL = /^data:image\/(png|gif|jpeg|webp|avif)[;,]/i;

const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  Tab: '\t',
  NewLine: '\n',
  sol: '/',
  quest: '?',
  num: '#',
  semi: ';',
};

interface ParsedAttribute {
  name: string;
  value: string | undefined;
}

interface ParsedTag {
  name: string;
  attributes: ParsedAttribute[];
  selfClosing: boolean;
  end: number;
}

/**
 * Sanitize widget markup according to `ui.contentSecurity`.
 *
 * By default it removes `<script>` elements, `on*` event handler attributes, `srcdoc`, `<object>`,
 * `<embed>`, `<applet>`, `<base>` and `<meta>`, and every URL attribute whose scheme is not
 * `http:`, `https:` or `mailto:` (relative URLs and, in `<img src>`, raster `data:image/…` URLs stay).
 * `allowInlineScripts` keeps scripts, handlers and embedded objects; `allowUnsafeLinks` keeps every
 * URL; `bypassSanitization` returns the markup unchanged.
 */
export function sanitizeHtml(markup: string, policy: UIContentSecurity = {}): string {
  if (policy.bypassSanitization) return markup;
  const output: string[] = [];
  let index = 0;

  while (index < markup.length) {
    const open = markup.indexOf('<', index);
    if (open === -1) {
      output.push(markup.slice(index));
      break;
    }
    output.push(markup.slice(index, open));
    const next = markup[open + 1] ?? '';

    if (next === '!' || next === '?') {
      index = skipDeclaration(markup, open);
    } else if (next === '/') {
      index = writeEndTag(markup, open, output, policy);
    } else if (isAsciiLetter(next)) {
      index = writeElement(markup, open, output, policy);
    } else {
      output.push('&lt;');
      index = open + 1;
    }
  }

  return output.join('');
}

function isAsciiLetter(character: string): boolean {
  return /^[A-Za-z]$/.test(character);
}

/** Comments, doctypes, CDATA sections and processing instructions: dropped. */
function skipDeclaration(markup: string, open: number): number {
  if (markup.startsWith('<!--', open)) {
    const candidates = [markup.indexOf('-->', open + 2), markup.indexOf('--!>', open + 2)].filter((at) => at !== -1);
    if (candidates.length === 0) return markup.length;
    const close = Math.min(...candidates);
    return close + (markup.startsWith('--!>', close) ? 4 : 3);
  }
  const close = markup.indexOf('>', open);
  return close === -1 ? markup.length : close + 1;
}

function writeEndTag(markup: string, open: number, output: string[], policy: UIContentSecurity): number {
  if (!isAsciiLetter(markup[open + 2] ?? '')) {
    // `</>` is ignored; `</` and anything else is a bogus comment
    return markup.startsWith('</>', open) ? open + 3 : skipDeclaration(markup, open);
  }
  const tag = parseTag(markup, open + 2);
  if (!tag) return markup.length;
  const name = tag.name.toLowerCase();
  if (TAG_NAME.test(tag.name) && !isDroppedTag(name, policy)) output.push(`</${tag.name}>`);
  return tag.end;
}

function writeElement(markup: string, open: number, output: string[], policy: UIContentSecurity): number {
  const tag = parseTag(markup, open + 1);
  // A tag cut off by the end of the markup is dropped by the browser, with everything after it
  if (!tag) return markup.length;
  const name = tag.name.toLowerCase();

  if (name === 'plaintext') {
    output.push(markup.slice(tag.end).replace(/</g, '&lt;'));
    return markup.length;
  }

  const keepContent = RAW_TEXT_CONTENT[name];
  if (keepContent) {
    const { content, end } = readRawText(markup, tag.end, name);
    if (name === 'script' && !policy.allowInlineScripts) return end;
    output.push(`<${tag.name}${writeAttributes(name, tag.attributes, policy)}>${keepContent(content)}</${tag.name}>`);
    return end;
  }

  if (TAG_NAME.test(tag.name) && !isDroppedTag(name, policy)) {
    output.push(`<${tag.name}${writeAttributes(name, tag.attributes, policy)}${tag.selfClosing ? ' /' : ''}>`);
  }
  return tag.end;
}

function isDroppedTag(name: string, policy: UIContentSecurity): boolean {
  return ALWAYS_DROPPED_TAGS.has(name) || (!policy.allowInlineScripts && SCRIPT_LIKE_TAGS.has(name));
}

/** The text of a raw-text element, up to `</name` followed by whitespace, `/` or `>`. */
function readRawText(markup: string, start: number, name: string): { content: string; end: number } {
  const lower = markup.toLowerCase();
  let at = lower.indexOf(`</${name}`, start);
  while (at !== -1 && !/[\t\n\f\r />]/.test(markup[at + name.length + 2] ?? '>')) {
    at = lower.indexOf(`</${name}`, at + 1);
  }
  if (at === -1) return { content: markup.slice(start), end: markup.length };
  const endTag = parseTag(markup, at + 2);
  return { content: markup.slice(start, at), end: endTag ? endTag.end : markup.length };
}

/**
 * Read a tag from its name to its closing `>`, as the tokenizer's tag and attribute states do.
 * Returns `undefined` when the markup ends inside the tag.
 */
function parseTag(markup: string, start: number): ParsedTag | undefined {
  let index = start;
  while (index < markup.length && !/[\t\n\f\r />]/.test(markup[index])) index++;
  const tag: ParsedTag = { name: markup.slice(start, index), attributes: [], selfClosing: false, end: 0 };

  while (index < markup.length) {
    const character = markup[index];
    if (WHITESPACE.test(character)) {
      index++;
    } else if (character === '>') {
      tag.end = index + 1;
      return tag;
    } else if (character === '/') {
      index++;
      if (markup[index] === '>') {
        tag.selfClosing = true;
        tag.end = index + 1;
        return tag;
      }
    } else {
      index = readAttribute(markup, index, tag.attributes);
    }
  }
  return undefined;
}

function readAttribute(markup: string, start: number, attributes: ParsedAttribute[]): number {
  // The first character may be `=`; the name runs to whitespace, `/`, `>` or `=`
  let index = start + 1;
  while (index < markup.length && !/[\t\n\f\r />=]/.test(markup[index])) index++;
  const attribute: ParsedAttribute = { name: markup.slice(start, index), value: undefined };
  attributes.push(attribute);

  let afterName = index;
  while (afterName < markup.length && WHITESPACE.test(markup[afterName])) afterName++;
  if (markup[afterName] !== '=') return afterName;

  index = afterName + 1;
  while (index < markup.length && WHITESPACE.test(markup[index])) index++;
  const quote = markup[index];
  if (quote === '"' || quote === "'") {
    const close = markup.indexOf(quote, index + 1);
    if (close === -1) return markup.length;
    attribute.value = markup.slice(index + 1, close);
    return close + 1;
  }
  if (quote === '>') {
    attribute.value = '';
    return index;
  }
  const valueStart = index;
  while (index < markup.length && !/[\t\n\f\r >]/.test(markup[index])) index++;
  attribute.value = markup.slice(valueStart, index);
  return index;
}

function writeAttributes(tagName: string, attributes: ParsedAttribute[], policy: UIContentSecurity): string {
  const seen = new Set<string>();
  const animatesLink =
    ANIMATION_TAGS.has(tagName) &&
    attributes.some(({ name, value }) => name.toLowerCase() === 'attributename' && isLinkAttributeName(value ?? ''));
  let written = '';

  for (const { name, value } of attributes) {
    const lowerName = name.toLowerCase();
    // Like the browser, keep the first of duplicate attributes
    if (seen.has(lowerName)) continue;
    seen.add(lowerName);
    if (!isWritableAttributeName(name)) continue;
    if (!policy.allowInlineScripts && (lowerName.startsWith('on') || lowerName === 'srcdoc')) continue;
    if (!policy.allowUnsafeLinks && !isAllowedValue(tagName, lowerName, value ?? '', animatesLink)) continue;
    written +=
      value === undefined
        ? ` ${name}`
        : ` ${name}="${value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}"`;
  }
  return written;
}

function isWritableAttributeName(name: string): boolean {
  if (name.length === 0 || ATTRIBUTE_NAME_BREAKERS.test(name)) return false;
  return [...name].every((character) => character.charCodeAt(0) > 0x1f && character.charCodeAt(0) !== 0x7f);
}

function isLinkAttributeName(value: string): boolean {
  return /^\s*(xlink:)?href\s*$/i.test(value);
}

function isAllowedValue(tagName: string, attributeName: string, value: string, animatesLink: boolean): boolean {
  const allowImageData = tagName === 'img' && attributeName === 'src';
  if (URL_ATTRIBUTES.has(attributeName)) return isSafeUrl(value, allowImageData);
  if (URL_LIST_ATTRIBUTES.has(attributeName)) {
    const separator = attributeName === 'ping' ? /\s+/ : /,/;
    return value.split(separator).every((candidate) => isSafeUrl(candidate.trim().split(/\s+/)[0] ?? '', false));
  }
  if (animatesLink && ANIMATION_VALUE_ATTRIBUTES.has(attributeName)) {
    return value.split(';').every((candidate) => isSafeUrl(candidate, false));
  }
  return true;
}

/** Whether a URL attribute value, as the browser decodes and parses it, names a safe scheme or none. */
function isSafeUrl(rawValue: string, allowImageData: boolean): boolean {
  const url = trimLeadingControls(decodeCharacterReferences(rawValue).replace(/[\t\n\r]/g, ''));
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(url);
  if (scheme) {
    return SAFE_SCHEMES.has(scheme[1].toLowerCase()) || (allowImageData && RASTER_IMAGE_DATA_URL.test(url));
  }
  // A named reference the decoder doesn't know could hide a scheme: refuse one before the path starts
  return !/&[A-Za-z]/.test(url.split(/[/?#]/, 1)[0]);
}

/** The URL parser drops leading C0 controls and spaces. */
function trimLeadingControls(value: string): string {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) <= 0x20) start++;
  return value.slice(start);
}

function decodeCharacterReferences(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_match, decimal: string) => fromCodePoint(parseInt(decimal, 10)))
    .replace(/&([A-Za-z]+);/g, (match, name: string) => NAMED_REFERENCES[name] ?? match);
}

function fromCodePoint(codePoint: number): string {
  return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '�';
}

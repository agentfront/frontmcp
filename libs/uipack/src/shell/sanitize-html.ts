/**
 * Widget markup sanitizer for `ui.contentSecurity`.
 *
 * The markup is tokenized the way the HTML tokenizer reads it and written back out: every tag is
 * rebuilt from its parsed name and attributes, text never carries a `<`, and each attribute value is
 * decoded once, checked, and written back escaped, so the browser reads exactly the value that was
 * checked. Comments, doctypes and processing instructions are dropped. Every scan moves forward
 * through the markup, so the time it takes grows linearly with its length.
 *
 * @packageDocumentation
 */

import { decodeHTMLAttribute } from 'entities';

import type { UIContentSecurity } from '../types/ui-config';
import { sanitizeStyleAttribute, sanitizeStyleText } from './sanitize-css';

/** The longest markup {@link sanitizeHtml} takes by default, in characters: 2 Mi. */
export const DEFAULT_MAX_MARKUP_LENGTH = 2 * 1024 * 1024;

const POLICY_FLAGS = ['allowUnsafeLinks', 'allowInlineScripts', 'allowToolCallAttributes', 'bypassSanitization'];

const WHITESPACE = /[\t\n\f\r ]/;
const TAG_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
// Written as `name="value"`, a name without these characters, whitespace or controls reads back the same
const ATTRIBUTE_NAME_BREAKERS = /[\s"'<>/=]/;
const COMMENT_END = /--!?>/g;

/** Elements whose content the tokenizer reads as text up to their end tag, and what is kept of it. */
const RAW_TEXT_CONTENT: Record<string, (content: string) => string> = {
  script: (content) => content,
  style: sanitizeStyleText,
  // `&lt;` reads back as `<` in RCDATA and in SVG text alike, and leaves no `<` to read as a tag
  textarea: (content) => content.replace(/</g, '&lt;'),
  title: (content) => content.replace(/</g, '&lt;'),
  xmp: (content) => content.replace(/</g, '&lt;'),
  iframe: () => '',
  noembed: () => '',
  noframes: () => '',
  noscript: () => '',
};

/** One end-tag pattern per raw-text element: `</name` and whitespace, `/` or `>`, matched in ASCII case only. */
const RAW_TEXT_END = Object.fromEntries(
  Object.keys(RAW_TEXT_CONTENT).map((name) => [name, new RegExp(`</${name}(?=[\\t\\n\\f\\r />])`, 'gi')]),
);

/**
 * Elements removed with their attributes: ones that redirect the page or load code or documents
 * whatever their attributes say, and SVG animations, which can set any attribute (an `href`) later.
 */
const DROPPED_TAGS = new Set([
  'base',
  'meta',
  'object',
  'embed',
  'applet',
  'animate',
  'animatecolor',
  'animatemotion',
  'animatetransform',
  'set',
]);

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
const SCRIPT_SOURCE_ATTRIBUTES = new Set(['src', 'href', 'xlink:href']);
const TOOL_CALL_ATTRIBUTES = new Set(['data-tool-call', 'data-tool-args']);

/** The attributes that navigate when the user follows them: `allowUnsafeLinks` relaxes only these. */
const NAVIGATION_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href', 'xlink:href']),
  area: new Set(['href', 'xlink:href']),
  form: new Set(['action']),
  button: new Set(['formaction']),
  input: new Set(['formaction']),
};

const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
const RASTER_IMAGE_DATA_URL = /^data:image\/(png|gif|jpeg|webp|avif)[;,]/i;
const URL_SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

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
 * Sanitize widget markup according to `ui.contentSecurity`. See {@link UIContentSecurity} for what
 * it removes and what each flag keeps.
 *
 * @throws TypeError when `policy` isn't a `ui.contentSecurity` object, and RangeError when the
 *   markup is longer than `policy.maxMarkupLength`; the markup is never returned unsanitized
 */
export function sanitizeHtml(markup: string, policy: UIContentSecurity = {}): string {
  const problems = describeContentSecurityProblems(policy);
  if (problems.length > 0) throw new TypeError(problems.join(' '));
  if (policy.bypassSanitization) return markup;
  const maxLength = policy.maxMarkupLength ?? DEFAULT_MAX_MARKUP_LENGTH;
  if (markup.length > maxLength) {
    throw new RangeError(
      `The markup is ${markup.length} characters, over the ${maxLength} that \`ui.contentSecurity\` sanitizes ` +
        '(`maxMarkupLength`), so it is not rendered.',
    );
  }

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
      index = writeEndTag(markup, open, output);
    } else if (isAsciiLetter(next)) {
      index = writeElement(markup, open, output, policy);
    } else {
      output.push('&lt;');
      index = open + 1;
    }
  }

  return output.join('');
}

/**
 * Why a value can't be a `ui.contentSecurity` policy, one sentence each: it must be a plain object
 * whose flags are booleans and whose `maxMarkupLength` is a positive integer.
 */
export function describeContentSecurityProblems(policy: unknown): string[] {
  if (!isPlainObject(policy)) {
    return [`\`ui.contentSecurity\` must be an object of flags, and it is ${describeValue(policy)}.`];
  }
  const problems: string[] = [];
  for (const [key, value] of Object.entries(policy)) {
    if (value === undefined) continue;
    if (POLICY_FLAGS.includes(key)) {
      if (typeof value !== 'boolean') {
        problems.push(`\`ui.contentSecurity.${key}\` must be true or false, and it is ${describeValue(value)}.`);
      }
    } else if (key === 'maxMarkupLength') {
      if (!Number.isSafeInteger(value) || (value as number) <= 0) {
        problems.push(
          `\`ui.contentSecurity.maxMarkupLength\` must be a positive integer, and it is ${describeValue(value)}.`,
        );
      }
    } else {
      problems.push(
        `\`ui.contentSecurity\` has no \`${key}\` option; its options are \`${POLICY_FLAGS.join('`, `')}\` and \`maxMarkupLength\`.`,
      );
    }
  }
  return problems;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeValue(value: unknown): string {
  if (value === null || Array.isArray(value)) return JSON.stringify(value);
  return typeof value === 'object' || typeof value === 'function'
    ? `a ${typeof value}`
    : `${typeof value} ${JSON.stringify(value)}`;
}

function isAsciiLetter(character: string): boolean {
  return /^[A-Za-z]$/.test(character);
}

/** Tag and attribute names are case-insensitive in ASCII only, as in the HTML tokenizer. */
function asciiLowerCase(text: string): string {
  return text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/** Comments, doctypes, CDATA sections and processing instructions: dropped. */
function skipDeclaration(markup: string, open: number): number {
  if (markup.startsWith('<!--', open)) {
    // From `<!--` itself, so `<!-->` and `<!--->` end at once, as in the browser
    COMMENT_END.lastIndex = open + 2;
    const close = COMMENT_END.exec(markup);
    return close ? close.index + close[0].length : markup.length;
  }
  const close = markup.indexOf('>', open);
  return close === -1 ? markup.length : close + 1;
}

function writeEndTag(markup: string, open: number, output: string[]): number {
  if (!isAsciiLetter(markup[open + 2] ?? '')) {
    // `</>` is ignored; `</` and anything else is a bogus comment
    return markup.startsWith('</>', open) ? open + 3 : skipDeclaration(markup, open);
  }
  const tag = parseTag(markup, open + 2);
  if (!tag) return markup.length;
  if (TAG_NAME.test(tag.name) && !DROPPED_TAGS.has(asciiLowerCase(tag.name))) output.push(`</${tag.name}>`);
  return tag.end;
}

function writeElement(markup: string, open: number, output: string[], policy: UIContentSecurity): number {
  const tag = parseTag(markup, open + 1);
  // A tag cut off by the end of the markup is dropped by the browser, with everything after it
  if (!tag) return markup.length;
  const name = asciiLowerCase(tag.name);

  if (name === 'plaintext') {
    output.push(markup.slice(tag.end).replace(/</g, '&lt;'));
    return markup.length;
  }

  const keepContent = RAW_TEXT_CONTENT[name];
  if (keepContent) {
    const { content, end } = readRawText(markup, tag.end, name);
    if (name === 'script' && !isAllowedScript(tag, policy)) return end;
    output.push(`<${tag.name}${writeAttributes(name, tag.attributes, policy)}>${keepContent(content)}</${tag.name}>`);
    return end;
  }

  if (TAG_NAME.test(tag.name) && !DROPPED_TAGS.has(name) && !isCrossOriginStylesheet(name, tag.attributes)) {
    output.push(`<${tag.name}${writeAttributes(name, tag.attributes, policy)}${tag.selfClosing ? ' /' : ''}>`);
  }
  return tag.end;
}

/** A script written in the markup, with `allowInlineScripts`; never one that loads its code from a URL. */
function isAllowedScript(tag: ParsedTag, policy: UIContentSecurity): boolean {
  return (
    policy.allowInlineScripts === true &&
    !tag.attributes.some(({ name }) => SCRIPT_SOURCE_ATTRIBUTES.has(asciiLowerCase(name)))
  );
}

/** A `<link rel="stylesheet">` whose `href` names a scheme or another host (`//host/…`). */
function isCrossOriginStylesheet(tagName: string, attributes: ParsedAttribute[]): boolean {
  if (tagName !== 'link') return false;
  const rel = attributeValue(attributes, 'rel');
  const href = attributeValue(attributes, 'href');
  if (rel === undefined || href === undefined || !/(^|[\t\n\f\r ])stylesheet($|[\t\n\f\r ])/i.test(rel)) return false;
  const url = urlAsParsed(href);
  return URL_SCHEME.test(url) || /^[\\/]{2}/.test(url);
}

/** The decoded value of the first attribute named `name`, as the browser keeps the first of duplicates. */
function attributeValue(attributes: ParsedAttribute[], name: string): string | undefined {
  const attribute = attributes.find((candidate) => asciiLowerCase(candidate.name) === name);
  return attribute?.value === undefined ? undefined : decodeAttributeValue(attribute.value);
}

/** The text of a raw-text element, up to its end tag, found by one forward scan of the markup. */
function readRawText(markup: string, start: number, name: string): { content: string; end: number } {
  const endTag = RAW_TEXT_END[name];
  endTag.lastIndex = start;
  const match = endTag.exec(markup);
  if (!match) return { content: markup.slice(start), end: markup.length };
  const tag = parseTag(markup, match.index + 2);
  return { content: markup.slice(start, match.index), end: tag ? tag.end : markup.length };
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

/** An attribute value as the browser reads it: character references decoded, NUL replaced. */
function decodeAttributeValue(raw: string): string {
  return decodeHTMLAttribute(raw).split('\u0000').join('\ufffd');
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function writeAttributes(tagName: string, attributes: ParsedAttribute[], policy: UIContentSecurity): string {
  const seen = new Set<string>();
  let written = '';

  for (const attribute of attributes) {
    const name = asciiLowerCase(attribute.name);
    // Like the browser, keep the first of duplicate attributes
    if (seen.has(name)) continue;
    seen.add(name);
    if (!isWritableAttributeName(attribute.name) || name === 'srcdoc') continue;
    if (name.startsWith('on') && !policy.allowInlineScripts) continue;
    if (TOOL_CALL_ATTRIBUTES.has(name) && !policy.allowToolCallAttributes) continue;
    if (attribute.value === undefined) {
      written += ` ${attribute.name}`;
      continue;
    }
    const value = decodeAttributeValue(attribute.value);
    if (!isAllowedValue(tagName, name, value, policy)) continue;
    written += ` ${attribute.name}="${escapeAttributeValue(name === 'style' ? sanitizeStyleAttribute(value) : value)}"`;
  }
  return written;
}

function isWritableAttributeName(name: string): boolean {
  if (name.length === 0 || ATTRIBUTE_NAME_BREAKERS.test(name)) return false;
  return [...name].every((character) => character.charCodeAt(0) > 0x1f && character.charCodeAt(0) !== 0x7f);
}

function isAllowedValue(tagName: string, attributeName: string, value: string, policy: UIContentSecurity): boolean {
  if (URL_ATTRIBUTES.has(attributeName)) {
    return isAllowedUrl(value, {
      imageData: tagName === 'img' && attributeName === 'src',
      navigation: policy.allowUnsafeLinks === true && NAVIGATION_ATTRIBUTES[tagName]?.has(attributeName) === true,
    });
  }
  if (URL_LIST_ATTRIBUTES.has(attributeName)) {
    const separator = attributeName === 'ping' ? /\s+/ : /,/;
    return value.split(separator).every((candidate) => isAllowedUrl(candidate.trim().split(/\s+/)[0] ?? '', {}));
  }
  return true;
}

/**
 * A URL value with the tabs and newlines the URL parser removes, and its leading C0 controls and
 * spaces gone. Leading Unicode whitespace goes too, which no browser strips: a check that reads more
 * values as having a scheme only refuses more.
 */
function urlAsParsed(value: string): string {
  const url = value.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < url.length && (url.charCodeAt(start) <= 0x20 || /\s/.test(url[start]))) start++;
  return url.slice(start);
}

/**
 * Whether a decoded URL value may stay: no scheme, or `http:`, `https:` or `mailto:`; a raster
 * `data:image/…` URL where an image is shown; and any scheme but `data:` in a navigation attribute
 * with `allowUnsafeLinks`.
 */
function isAllowedUrl(value: string, allowed: { imageData?: boolean; navigation?: boolean }): boolean {
  const url = urlAsParsed(value);
  const scheme = URL_SCHEME.exec(url)?.[1].toLowerCase();
  if (scheme === undefined || SAFE_SCHEMES.has(scheme)) return true;
  if (scheme === 'data') return allowed.imageData === true && RASTER_IMAGE_DATA_URL.test(url);
  return allowed.navigation === true;
}

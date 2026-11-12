/**
 * The CSS part of `ui.contentSecurity`: `@import` rules are removed from style elements, and
 * `position: fixed` and `position: sticky` declarations from style attributes. Other CSS is kept.
 *
 * @packageDocumentation
 */

// `\` and 1-6 hex digits with one optional whitespace, or `\` and any other character but a newline
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\n\r\f])?|([^\n\r\f0-9a-fA-F]))/g;
const CSS_ESCAPE_AT = new RegExp(CSS_ESCAPE.source, 'y');
const CSS_COMMENT = /\/\*[\s\S]*?(?:\*\/|$)/g;

/** CSS text with its escapes read as the characters they stand for. */
function unescapeCss(text: string): string {
  return text.replace(CSS_ESCAPE, (_match, hex: string | undefined, character: string | undefined) => {
    if (hex === undefined) return character ?? '';
    const codePoint = parseInt(hex, 16);
    const valid = codePoint > 0 && codePoint <= 0x10ffff && (codePoint < 0xd800 || codePoint > 0xdfff);
    return valid ? String.fromCodePoint(codePoint) : '\ufffd';
  });
}

/**
 * The text of a `<style>` element, written so that the HTML parser reads it the same way as raw
 * text (in HTML) and as character data (in SVG or MathML): no `<`, and no `&` that could start a
 * character reference, each written as a CSS escape. `@import` rules are removed.
 */
export function sanitizeStyleText(css: string): string {
  return removeImports(css.replace(/</g, '\\3c ').replace(/&(?=[#A-Za-z0-9])/g, '\\26 '));
}

/**
 * Remove every `@import` at-keyword (its name read with CSS escapes) and the rest of its statement,
 * wherever it is, strings and comments included: removing more than the browser would read as a
 * rule only removes more. A space stands where the text was, so what's left can't join into a new
 * `@import`.
 */
function removeImports(css: string): string {
  const kept: string[] = [];
  let start = 0;
  let index = css.indexOf('@');
  while (index !== -1) {
    const nameEnd = identEnd(css, index + 1);
    if (unescapeCss(css.slice(index + 1, nameEnd)).toLowerCase() === 'import') {
      kept.push(css.slice(start, index), ' ');
      start = statementEnd(css, nameEnd);
      index = css.indexOf('@', start);
    } else {
      index = css.indexOf('@', index + 1);
    }
  }
  kept.push(css.slice(start));
  return kept.join('');
}

function commentEnd(css: string, start: number): number {
  const end = css.indexOf('*/', start + 2);
  return end === -1 ? css.length : end + 2;
}

/** The end of a quoted string, which a newline also ends. */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  let index = start + 1;
  while (index < css.length && css[index] !== quote && css[index] !== '\n') {
    index += css[index] === '\\' ? 2 : 1;
  }
  return Math.min(index + 1, css.length);
}

function isIdentCharacter(character: string): boolean {
  return character === '-' || /\w/.test(character) || character.charCodeAt(0) >= 0x80;
}

function identEnd(css: string, start: number): number {
  let index = start;
  while (index < css.length) {
    CSS_ESCAPE_AT.lastIndex = index;
    if (CSS_ESCAPE_AT.test(css)) {
      index = CSS_ESCAPE_AT.lastIndex;
    } else if (isIdentCharacter(css[index])) {
      index++;
    } else {
      break;
    }
  }
  return index;
}

/** Where an at-rule's statement ends: after its `;` or its `{}` block, outside strings and brackets. */
function statementEnd(css: string, start: number): number {
  let depth = 0;
  let index = start;
  while (index < css.length) {
    const character = css[index];
    if (character === '/' && css[index + 1] === '*') {
      index = commentEnd(css, index);
      continue;
    }
    if (character === '"' || character === "'") {
      index = stringEnd(css, index);
      continue;
    }
    if (character === '(' || character === '[' || character === '{') depth++;
    if (character === ')' || character === ']') depth = Math.max(0, depth - 1);
    if (character === '}') {
      if (depth === 0) return index;
      depth--;
      if (depth === 0) return index + 1;
    }
    if (character === ';' && depth === 0) return index + 1;
    index++;
  }
  return css.length;
}

/**
 * A style attribute without `position: fixed` or `position: sticky` declarations (nor `position`
 * set from a custom property), which would let the markup lay itself over the whole widget.
 */
export function sanitizeStyleAttribute(style: string): string {
  const declarations = splitDeclarations(style);
  const kept = declarations.filter((declaration) => !isFixedPosition(declaration));
  return kept.length === declarations.length ? style : kept.join(';');
}

function splitDeclarations(style: string): string[] {
  const declarations: string[] = [];
  let depth = 0;
  let start = 0;
  let index = 0;
  while (index < style.length) {
    const character = style[index];
    if (character === '/' && style[index + 1] === '*') {
      index = commentEnd(style, index);
      continue;
    }
    if (character === '"' || character === "'") {
      index = stringEnd(style, index);
      continue;
    }
    if (character === '(') depth++;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === ';' && depth === 0) {
      declarations.push(style.slice(start, index));
      start = index + 1;
    }
    index++;
  }
  declarations.push(style.slice(start));
  return declarations;
}

function isFixedPosition(declaration: string): boolean {
  const text = declaration.replace(CSS_COMMENT, '');
  const colon = text.indexOf(':');
  if (colon === -1) return false;
  const property = unescapeCss(text.slice(0, colon)).trim().toLowerCase();
  const value = unescapeCss(text.slice(colon + 1)).toLowerCase();
  return property === 'position' && /fixed|sticky|var\(/.test(value);
}

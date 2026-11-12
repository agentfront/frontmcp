/**
 * Minimal, safe Markdown to HTML conversion for `ui.template` strings.
 *
 * Supports headings, paragraphs, fenced code, ordered/unordered lists and inline
 * bold, italic, code and http(s)/mailto links. Everything else is escaped text; raw HTML in the
 * source is never passed through. `ui.runtimeOptions.markdown` adds GitHub-flavored Markdown and
 * highlighted code.
 */

import { escapeHtml } from '../utils';

/** `ui.runtimeOptions.markdown`, with the highlighter loaded for its theme. */
export interface MarkdownOptions {
  /** GitHub-flavored Markdown: tables, task list items, `~~strikethrough~~` and links for bare URLs. */
  gfm?: boolean;
  /** Highlights the code of a fenced block: its HTML, or `undefined` for a language it doesn't know. */
  highlight?: (code: string, language: string) => string | undefined;
}

const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

// U+E000 delimits held markup. No regular expression names it: a bundler writes the character itself
// into a regular-expression literal, which the published build can't escape.
const PLACEHOLDER = '\uE000';
// A bare URL in escaped text ends at whitespace or a `<` (escaped), and before held markup
const BARE_URL = /(?<![\w/@.])(?:https?:\/\/|www\.)(?:(?!&lt;)[^\s<])+/gi;
const AUTOLINK_PUNCTUATION = '?!.,:*_~';
const ENTITY_NAME_CHARACTER = /[a-z0-9#]/i;
const HREF_END = /[)\s]/g;
// Tested on the trimmed line: surrounding `\s*` on both sides would try every split of the whitespace
const TABLE_DELIMITER = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/;
const TASK_ITEM = /^\[([ xX])\]\s+(.*)$/;

function emphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Replace each `[label](href)` link: the label runs to the first `]`, the href to the first `)` or whitespace.
 * Links that share a `]` or an href share its search, so the text is read once.
 */
function replaceLinks(text: string, render: (label: string, href: string) => string): string {
  let result = '';
  let copied = 0;
  let labelEnd = -1;
  let hrefEnd = -1;
  let start = text.indexOf('[');
  while (start !== -1) {
    if (labelEnd < start) labelEnd = text.indexOf(']', start + 1);
    if (labelEnd === -1) break;
    const hrefStart = labelEnd + 2;
    if (labelEnd > start + 1 && text[labelEnd + 1] === '(') {
      if (hrefEnd < hrefStart) {
        HREF_END.lastIndex = hrefStart;
        hrefEnd = HREF_END.exec(text)?.index ?? text.length;
      }
      if (hrefEnd > hrefStart && text[hrefEnd] === ')') {
        result += text.slice(copied, start) + render(text.slice(start + 1, labelEnd), text.slice(hrefStart, hrefEnd));
        copied = hrefEnd + 1;
        start = text.indexOf('[', copied);
        continue;
      }
    }
    start = text.indexOf('[', start + 1);
  }
  return result + text.slice(copied);
}

/** Where the character reference (`&name;`) that ends the text at `end` starts, or -1. */
function entityStart(text: string, end: number): number {
  if (text[end - 1] !== ';') return -1;
  let index = end - 2;
  while (index >= 0 && ENTITY_NAME_CHARACTER.test(text[index])) index--;
  return index < end - 2 && text[index] === '&' ? index : -1;
}

/** GitHub's rules for where a bare URL ends: not on trailing punctuation, an entity or an unmatched `)`. */
function trimAutolink(url: string): string {
  let end = url.length;
  let unmatchedCloses = url.split(')').length - url.split('(').length;
  for (;;) {
    const last = url[end - 1] ?? '';
    const entity = entityStart(url, end);
    if (last !== '' && AUTOLINK_PUNCTUATION.includes(last)) {
      end--;
    } else if (entity !== -1) {
      end = entity;
    } else if (last === ')' && unmatchedCloses > 0) {
      end--;
      unmatchedCloses--;
    } else {
      return url.slice(0, end);
    }
  }
}

function inline(text: string, gfm = false): string {
  const stash: string[] = [];
  const hold = (html: string) => PLACEHOLDER + (stash.push(html) - 1) + PLACEHOLDER;
  // Every other part between delimiters is a held index; held links can hold code spans, so restore twice
  const restore = (value: string) =>
    value
      .split(PLACEHOLDER)
      .map((part, i) => (i % 2 === 1 ? stash[Number(part)] : part))
      .join('');
  // The delimiter must not come from the input
  let out = escapeHtml(text.split(PLACEHOLDER).join('')).replace(/`([^`]+)`/g, (_m, code: string) =>
    hold(`<code>${code}</code>`),
  );
  // Links are stashed before emphasis so `*` / `**` inside an href never becomes markup
  out = replaceLinks(out, (label, href) =>
    SAFE_HREF.test(href) ? hold(`<a href="${href}" rel="noopener noreferrer">${emphasis(label)}</a>`) : label,
  );
  if (gfm) {
    out = out.replace(BARE_URL, (match: string) => {
      const url = trimAutolink(match.split(PLACEHOLDER, 1)[0]);
      const href = /^www\./i.test(url) ? `http://${url}` : url;
      return hold(`<a href="${href}" rel="noopener noreferrer">${url}</a>`) + match.slice(url.length);
    });
    out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  }
  out = emphasis(out);
  return restore(restore(out));
}

function listItem(item: string, gfm: boolean): string {
  const task = gfm ? TASK_ITEM.exec(item) : null;
  if (!task) return `<li>${inline(item, gfm)}</li>`;
  const checked = task[1] === ' ' ? '' : ' checked';
  return `<li class="task-list-item"><input type="checkbox" disabled${checked}> ${inline(task[2], gfm)}</li>`;
}

/** The cells of a table row; `\|` is a pipe inside a cell. */
function tableCells(row: string): string[] {
  const cells = row
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/);
  return cells.map((cell) => cell.trim().replace(/\\\|/g, '|'));
}

function cellAlignment(delimiter: string): string {
  const left = delimiter.startsWith(':');
  const right = delimiter.endsWith(':');
  if (left && right) return ' align="center"';
  if (right) return ' align="right"';
  return left ? ' align="left"' : '';
}

/** A GitHub-flavored table: a header row, a delimiter row with as many cells, then its body rows. */
function table(header: string, delimiter: string, body: string[]): string {
  const alignments = tableCells(delimiter).map(cellAlignment);
  const row = (cells: string[], tag: 'th' | 'td') =>
    `<tr>${alignments.map((align, i) => `<${tag}${align}>${inline(cells[i] ?? '', true)}</${tag}>`).join('')}</tr>`;
  const rows = body.map((line) => row(tableCells(line), 'td')).join('');
  return `<table><thead>${row(tableCells(header), 'th')}</thead>${rows ? `<tbody>${rows}</tbody>` : ''}</table>`;
}

function isTableStart(line: string, next: string | undefined): boolean {
  return (
    line.includes('|') &&
    next !== undefined &&
    TABLE_DELIMITER.test(next.trim()) &&
    tableCells(line).length === tableCells(next).length
  );
}

export function markdownToHtml(source: string, options: MarkdownOptions = {}): string {
  const gfm = options.gfm === true;
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push(`<p>${inline(paragraph.join(' '), gfm)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(`<${list.tag}>${list.items.map((item) => listItem(item, gfm)).join('')}</${list.tag}>`);
    list = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(`{3,})\s*([\w#+.-]*)/.exec(line);
    if (fence) {
      flushParagraph();
      flushList();
      const fenceLength = fence[1].length;
      const isClosing = (l: string) => {
        const m = /^\s*(`{3,})\s*$/.exec(l);
        return m !== null && m[1].length >= fenceLength;
      };
      const code: string[] = [];
      for (i++; i < lines.length && !isClosing(lines[i]); i++) code.push(lines[i]);
      blocks.push(codeBlock(code.join('\n'), fence[2], options.highlight));
      continue;
    }

    if (gfm && isTableStart(line, lines[i + 1])) {
      flushParagraph();
      flushList();
      const header = line;
      const delimiter = lines[i + 1];
      const body: string[] = [];
      for (i += 2; i < lines.length && lines[i].trim() !== '' && lines[i].includes('|'); i++) body.push(lines[i]);
      i--;
      blocks.push(table(header, delimiter, body));
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h${heading[1].length}>${inline(heading[2].trim(), gfm)}</h${heading[1].length}>`);
      continue;
    }

    const item = /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const tag = /\d/.test(item[1]) ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(item[2]);
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks.join('\n');
}

function codeBlock(code: string, language: string, highlight: MarkdownOptions['highlight']): string {
  if (!highlight) return `<pre><code>${escapeHtml(code)}\n</code></pre>`;
  const highlighted = language ? highlight(code, language) : undefined;
  const languageClass = language ? ` language-${language}` : '';
  return `<pre><code class="hljs${languageClass}">${highlighted ?? escapeHtml(code)}\n</code></pre>`;
}

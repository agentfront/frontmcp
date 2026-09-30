/**
 * Minimal, safe Markdown to HTML conversion for `ui.template` strings.
 *
 * Supports headings, paragraphs, fenced code, ordered/unordered lists and inline
 * bold, italic, code and http(s)/mailto links. Everything else is escaped text; raw HTML in the
 * source is never passed through.
 */

import { escapeHtml } from '../utils';

const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

function emphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function inline(text: string): string {
  const stash: string[] = [];
  const hold = (html: string) => `\uE000${stash.push(html) - 1}\uE000`;
  // U+E000 delimits placeholders, so it must not come from the input
  let out = escapeHtml(text.replace(/\uE000/g, '')).replace(/`([^`]+)`/g, (_m, code: string) =>
    hold(`<code>${code}</code>`),
  );
  // Links are stashed before emphasis so `*` / `**` inside an href never becomes markup
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) =>
    SAFE_HREF.test(href) ? hold(`<a href="${href}" rel="noopener noreferrer">${emphasis(label)}</a>`) : label,
  );
  out = emphasis(out);
  // Stashed links can contain code-span placeholders, so restore until none are left
  for (let i = 0; i < 2; i++) out = out.replace(/\uE000(\d+)\uE000/g, (_m, n: string) => stash[Number(n)]);
  return out;
}

export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | undefined;

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list)
      blocks.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.tag}>`);
    list = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = /^\s*(`{3,})/.exec(line);
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
      blocks.push(`<pre><code>${escapeHtml(code.join('\n'))}\n</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push(`<h${heading[1].length}>${inline(heading[2].trim())}</h${heading[1].length}>`);
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

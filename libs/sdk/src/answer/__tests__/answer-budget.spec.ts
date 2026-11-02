import type { CallToolResult, ReadResourceResult } from '@frontmcp/protocol';

import { BUDGET_META_KEY, fitJsonToBudget, fitResourceAnswer, fitToolAnswer } from '../answer-budget';

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

function events(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: index, message: `event ${index} `.padEnd(280, '.') }));
}

describe('answer budget', () => {
  describe('fitJsonToBudget', () => {
    it('returns a value within the budget untouched', () => {
      const value = { items: events(3), total: 3 };
      const fitted = fitJsonToBudget(value, 50_000);
      expect(fitted.value).toBe(value);
      expect(fitted.omitted).toEqual([]);
    });

    it('fits a 300 KB answer by dropping whole list items, newest kept, as valid JSON', () => {
      const value = { items: events(1000), total: 1000 };
      expect(bytesOf(value)).toBeGreaterThan(300_000);

      const fitted = fitJsonToBudget(value, 50_000);
      const fittedValue = fitted.value as { items: Array<{ id: number }>; total: number };

      expect(bytesOf(fittedValue)).toBeLessThanOrEqual(50_000);
      expect(JSON.parse(JSON.stringify(fittedValue))).toEqual(fittedValue);
      expect(fittedValue.total).toBe(1000);
      const keptIds = fittedValue.items.map((item) => item.id);
      expect(keptIds[keptIds.length - 1]).toBe(999);
      expect(keptIds).toEqual(Array.from({ length: keptIds.length }, (_, index) => 1000 - keptIds.length + index));
      expect(fitted.omitted).toEqual([{ path: '$.items', items: 1000 - keptIds.length, of: 1000 }]);
    });

    it('keeps the first items with keep-oldest', () => {
      const fitted = fitJsonToBudget({ items: events(1000) }, 20_000, 'keep-oldest');
      const items = (fitted.value as { items: Array<{ id: number }> }).items;
      expect(items[0].id).toBe(0);
      expect(items.map((item) => item.id)).toEqual(Array.from({ length: items.length }, (_, index) => index));
    });

    it('cuts the end of a long string and notes how many characters it left out', () => {
      const fitted = fitJsonToBudget({ title: 'report', body: 'x'.repeat(100_000) }, 10_000);
      const value = fitted.value as { title: string; body: string };
      expect(bytesOf(value)).toBeLessThanOrEqual(10_000);
      expect(value.title).toBe('report');
      expect(value.body).toBe('x'.repeat(value.body.length));
      expect(fitted.omitted).toEqual([{ path: '$.body', chars: 100_000 - value.body.length }]);
    });

    it('fits the one item it keeps when no whole item fits', () => {
      const fitted = fitJsonToBudget(
        { pages: [{ 'page text': 'a'.repeat(30_000) }, { 'page text': 'b'.repeat(30_000) }] },
        5_000,
      );
      const value = fitted.value as { pages: Array<Record<string, string>> };
      expect(bytesOf(value)).toBeLessThanOrEqual(5_000);
      expect(value.pages).toHaveLength(1);
      expect(value.pages[0]['page text'].startsWith('b')).toBe(true);
      expect(fitted.omitted).toEqual([
        { path: '$.pages', items: 1, of: 2 },
        { path: '$.pages[0]["page text"]', chars: 30_000 - value.pages[0]['page text'].length },
      ]);
    });

    it('never splits a surrogate pair and counts UTF-8 bytes', () => {
      const fitted = fitJsonToBudget({ text: '\u{1F600}'.repeat(5_000) }, 2_000);
      const text = (fitted.value as { text: string }).text;
      expect(bytesOf(fitted.value)).toBeLessThanOrEqual(2_000);
      expect(text.length % 2).toBe(0);
      expect(Array.from(text).every((character) => character === '\u{1F600}')).toBe(true);
    });

    it('leaves numbers and keys alone when nothing can shrink', () => {
      const value = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`key${index}`, index]));
      const fitted = fitJsonToBudget(value, 1_024);
      expect(fitted.value).toEqual(value);
      expect(fitted.omitted).toEqual([]);
    });
  });

  describe('fitToolAnswer', () => {
    const budget = { maxBytes: 20_000 };

    it('returns undefined for an answer within the budget', () => {
      const result: CallToolResult = {
        content: [{ type: 'text', text: '{"ok":true}' }],
        structuredContent: { ok: true },
      };
      expect(fitToolAnswer(result, budget)).toBeUndefined();
    });

    it('fits structuredContent and the text that repeats it alike, and notes what it left out', () => {
      const structuredContent = { items: events(500), total: 500 };
      const result: CallToolResult = {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
        _meta: { traced: 'yes' },
      };

      const fitted = fitToolAnswer(result, budget);
      if (!fitted) throw new Error('expected the answer to be fitted');

      const fittedStructured = fitted.structuredContent as { items: unknown[] };
      expect(bytesOf(fittedStructured)).toBeLessThanOrEqual(20_000);
      expect(fitted.content[0]).toEqual({ type: 'text', text: JSON.stringify(fittedStructured) });
      const dropped = 500 - fittedStructured.items.length;
      expect(fitted.content[1]).toEqual({
        type: 'text',
        text: `This answer was shortened to fit its 20000-byte budget: left out the first ${dropped} of 500 items of $.items.`,
      });
      expect(fitted._meta).toEqual({
        traced: 'yes',
        [BUDGET_META_KEY]: {
          maxBytes: 20_000,
          lists: 'keep-newest',
          omitted: [{ path: '$.items', items: dropped, of: 500 }],
        },
      });
    });

    it('fits JSON text without structuredContent, and cuts the end of plain text', () => {
      const json = fitToolAnswer(
        { content: [{ type: 'text', text: JSON.stringify(events(500)) }] },
        { maxBytes: 20_000, lists: 'keep-oldest' },
      );
      const jsonItems = JSON.parse((json?.content[0] as { text: string }).text) as Array<{ id: number }>;
      expect(jsonItems[0].id).toBe(0);
      expect((json?.content[1] as { text: string }).text).toContain(
        `the last ${500 - jsonItems.length} of 500 items of the answer`,
      );

      const plain = fitToolAnswer({ content: [{ type: 'text', text: 'line\n'.repeat(10_000) }] }, budget);
      const plainText = (plain?.content[0] as { text: string }).text;
      expect(new TextEncoder().encode(plainText).byteLength).toBeLessThanOrEqual(20_000);
      expect((plain?.content[1] as { text: string }).text).toBe(
        `This answer was shortened to fit its 20000-byte budget: left out the last ${50_000 - plainText.length} characters of the answer.`,
      );
    });

    it('cuts the end of text that only looks like JSON', () => {
      const fitted = fitToolAnswer({ content: [{ type: 'text', text: `{ not json ${'x'.repeat(30_000)}` }] }, budget);
      expect((fitted?.content[1] as { text: string }).text).toMatch(/characters of the answer\.$/);
    });

    it('names the first five parts it left out and counts the rest', () => {
      const structuredContent = Object.fromEntries(
        Array.from({ length: 8 }, (_, index) => [`field${index}`, 'v'.repeat(5_000)]),
      );
      const fitted = fitToolAnswer({ content: [], structuredContent }, { maxBytes: 2_048 });
      const note = (fitted?.content[0] as { text: string }).text;
      expect(note).toContain('; 3 more parts listed in _meta["frontmcp/budget"].');
      expect((fitted?._meta?.[BUDGET_META_KEY] as { omitted: unknown[] }).omitted).toHaveLength(8);
    });

    it('compacts pretty-printed JSON that fits once compacted, without a note', () => {
      const pretty = JSON.stringify({ items: events(60) }, null, 8);
      const fitted = fitToolAnswer({ content: [{ type: 'text', text: pretty }] }, budget);
      expect(fitted?.content).toEqual([{ type: 'text', text: JSON.stringify({ items: events(60) }) }]);
      expect(fitted?._meta).toBeUndefined();
    });

    it('leaves images alone', () => {
      const image = { type: 'image' as const, data: 'a'.repeat(50_000), mimeType: 'image/png' };
      expect(fitToolAnswer({ content: [image] }, budget)).toBeUndefined();
    });
  });

  describe('fitResourceAnswer', () => {
    it('fits text contents, leaves HTML and blobs alone, and adds the note as a text content', () => {
      const result: ReadResourceResult = {
        contents: [
          { uri: 'data://events', mimeType: 'application/json', text: JSON.stringify({ items: events(500) }) },
          { uri: 'ui://widget', mimeType: 'text/html;profile=mcp-app', text: '<p>'.repeat(20_000) },
          { uri: 'data://blob', mimeType: 'application/octet-stream', blob: 'b'.repeat(50_000) },
        ],
      };

      const fitted = fitResourceAnswer(result, { maxBytes: 20_000 });
      if (!fitted) throw new Error('expected the read to be fitted');

      const items = (JSON.parse((fitted.contents[0] as { text: string }).text) as { items: unknown[] }).items;
      expect(fitted.contents[1]).toBe(result.contents[1]);
      expect(fitted.contents[2]).toBe(result.contents[2]);
      expect(fitted.contents[3]).toEqual({
        uri: 'data://events',
        mimeType: 'text/plain',
        text: `This answer was shortened to fit its 20000-byte budget: left out the first ${500 - items.length} of 500 items of $.items.`,
      });
      expect(fitted._meta?.[BUDGET_META_KEY]).toEqual({
        maxBytes: 20_000,
        lists: 'keep-newest',
        omitted: [{ uri: 'data://events', path: '$.items', items: 500 - items.length, of: 500 }],
      });
    });

    it('returns undefined for a read within the budget', () => {
      expect(fitResourceAnswer({ contents: [{ uri: 'a://b', text: 'small' }] }, { maxBytes: 20_000 })).toBeUndefined();
    });
  });
});

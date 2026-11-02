import type { CallToolResult } from '@frontmcp/protocol';

import type { MetricsOptionsInterface } from '../../common/types/options/metrics';
import { ANSWER_COUNTERS, measureAnswer, meteringEnabled, recordAnswerCost } from '../answer-meter';

describe('answer meter', () => {
  describe('measureAnswer', () => {
    it('counts the answer bytes, a token estimate of bytes / 4 and the text that repeats structuredContent', () => {
      const structuredContent = { city: 'Zürich', temperature: 21 };
      const result: CallToolResult = {
        content: [
          { type: 'text', text: JSON.stringify(structuredContent) },
          { type: 'text', text: 'note' },
        ],
        structuredContent,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;

      expect(measureAnswer(result)).toEqual({
        bytes,
        estimatedTokens: Math.ceil(bytes / 4),
        duplicatedBytes: new TextEncoder().encode(JSON.stringify(structuredContent)).byteLength,
      });
    });

    it('counts no duplicated bytes without structuredContent', () => {
      expect(measureAnswer({ content: [{ type: 'text', text: '{}' }] }).duplicatedBytes).toBe(0);
    });
  });

  describe('meteringEnabled', () => {
    it.each<[MetricsOptionsInterface | undefined, boolean]>([
      [undefined, false],
      [{ enabled: false }, false],
      [{ enabled: true }, true],
      [{ enabled: true, include: [] }, true],
      [{ enabled: true, include: ['tools'] }, true],
      [{ enabled: true, include: ['process'] }, false],
    ])('is %j → %s', (metrics, expected) => {
      expect(meteringEnabled(metrics)).toBe(expected);
    });
  });

  describe('recordAnswerCost', () => {
    it('adds the cost to the three counters with the tool and client labels', () => {
      const increments: Array<[string, number, Record<string, string> | undefined]> = [];
      const createCounter = (name: string) => ({
        inc: (by?: number, attributes?: Record<string, string>) => increments.push([name, by ?? 1, attributes]),
      });

      recordAnswerCost(
        { bytes: 400, estimatedTokens: 100, duplicatedBytes: 150 },
        { tool: 'weather:get', client: 'codex' },
        createCounter,
      );

      const labels = { tool: 'weather:get', client: 'codex' };
      expect(increments).toEqual([
        [ANSWER_COUNTERS.bytes, 400, labels],
        [ANSWER_COUNTERS.estimatedTokens, 100, labels],
        [ANSWER_COUNTERS.duplicatedBytes, 150, labels],
      ]);
    });
  });
});

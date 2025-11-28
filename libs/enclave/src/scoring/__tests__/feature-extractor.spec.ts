/**
 * Feature Extractor Unit Tests
 */

import { FeatureExtractor } from '../feature-extractor';

describe('FeatureExtractor', () => {
  let extractor: FeatureExtractor;

  beforeEach(() => {
    extractor = new FeatureExtractor();
  });

  describe('extract()', () => {
    describe('tool call extraction', () => {
      it('should extract static tool calls', () => {
        const code = `
          const users = await callTool('users:list', { limit: 100 });
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls.length).toBe(1);
        expect(features.toolCalls[0].toolName).toBe('users:list');
        expect(features.toolCalls[0].isStaticName).toBe(true);
      });

      it('should detect dynamic tool names', () => {
        const code = `
          const toolName = getToolName();
          const result = await callTool(toolName, {});
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls.length).toBe(1);
        expect(features.toolCalls[0].toolName).toBe('<dynamic>');
        expect(features.toolCalls[0].isStaticName).toBe(false);
      });

      it('should extract __safe_callTool calls', () => {
        const code = `
          const users = await __safe_callTool('users:list', { limit: 50 });
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls.length).toBe(1);
        expect(features.toolCalls[0].toolName).toBe('users:list');
      });

      it('should extract argument keys', () => {
        const code = `
          const result = await callTool('users:search', {
            query: 'test',
            limit: 100,
            offset: 0
          });
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls[0].argumentKeys).toContain('query');
        expect(features.toolCalls[0].argumentKeys).toContain('limit');
        expect(features.toolCalls[0].argumentKeys).toContain('offset');
      });

      it('should extract string literals from arguments', () => {
        const code = `
          const result = await callTool('users:search', {
            query: '*',
            filter: 'active'
          });
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls[0].stringLiterals).toContain('*');
        expect(features.toolCalls[0].stringLiterals).toContain('active');
      });

      it('should extract numeric literals from arguments', () => {
        const code = `
          const result = await callTool('users:list', {
            limit: 10000,
            pageSize: 500
          });
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls[0].numericLiterals).toContain(10000);
        expect(features.toolCalls[0].numericLiterals).toContain(500);
      });
    });

    describe('loop detection', () => {
      it('should detect tool calls inside for-of loops', () => {
        const code = `
          const users = [];
          for (const user of users) {
            await callTool('emails:send', { to: user.email });
          }
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls[0].insideLoop).toBe(true);
        expect(features.toolCalls[0].loopDepth).toBe(1);
        expect(features.patterns.toolsInLoops).toContain('emails:send');
      });

      it('should detect tool calls inside for loops', () => {
        const code = `
          for (let i = 0; i < 100; i++) {
            await callTool('data:process', { index: i });
          }
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls[0].insideLoop).toBe(true);
        expect(features.patterns.maxLoopNesting).toBe(1);
      });

      it('should track nested loop depth', () => {
        const code = `
          for (const item of items) {
            for (const subitem of item.subitems) {
              await callTool('process:item', { id: subitem.id });
            }
          }
        `;

        const features = extractor.extract(code);

        expect(features.patterns.maxLoopNesting).toBe(2);
        expect(features.toolCalls[0].loopDepth).toBe(2);
      });

      it('should detect tool calls outside loops', () => {
        const code = `
          const users = await callTool('users:list', {});
          console.log(users);
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls.length).toBe(1);
        expect(features.toolCalls[0].insideLoop).toBe(false);
        expect(features.toolCalls[0].loopDepth).toBe(0);
      });
    });

    describe('sensitive field detection', () => {
      it('should detect authentication-related fields', () => {
        const code = `
          const result = await callTool('users:get', {
            fields: ['password', 'secretKey']
          });
        `;

        const features = extractor.extract(code);

        expect(features.sensitive.categories).toContain('authentication');
        expect(
          features.sensitive.fieldsAccessed.some(
            (f) => f.toLowerCase().includes('password') || f.toLowerCase().includes('secret'),
          ),
        ).toBe(true);
      });

      it('should detect PII fields', () => {
        const code = `
          const result = await callTool('users:search', {
            include: 'email,phone,ssn'
          });
        `;

        const features = extractor.extract(code);

        expect(features.sensitive.categories).toContain('pii');
      });

      it('should detect financial fields', () => {
        const code = `
          const account = await callTool('accounts:get', {
            fields: ['bankAccount', 'routingNumber']
          });
        `;

        const features = extractor.extract(code);

        expect(features.sensitive.categories).toContain('financial');
      });

      it('should detect internal fields', () => {
        const code = `
          const data = await callTool('system:debug', {
            fields: ['__internalState', '_privateData']
          });
        `;

        const features = extractor.extract(code);

        expect(features.sensitive.categories).toContain('internal');
      });
    });

    describe('pattern signals', () => {
      it('should count total tool calls', () => {
        const code = `
          const a = await callTool('tool:a', {});
          const b = await callTool('tool:b', {});
          const c = await callTool('tool:c', {});
        `;

        const features = extractor.extract(code);

        expect(features.patterns.totalToolCalls).toBe(3);
      });

      it('should count unique tools', () => {
        const code = `
          const a = await callTool('tool:a', {});
          const b = await callTool('tool:a', {});
          const c = await callTool('tool:b', {});
        `;

        const features = extractor.extract(code);

        expect(features.patterns.uniqueToolsCount).toBe(2);
      });

      it('should build tool sequence', () => {
        const code = `
          const users = await callTool('users:list', {});
          const sent = await callTool('emails:send', {});
        `;

        const features = extractor.extract(code);

        expect(features.patterns.toolSequence).toEqual(['users:list', 'emails:send']);
      });
    });

    describe('numeric signals', () => {
      it('should find max limit value', () => {
        const code = `
          const result = await callTool('data:query', { limit: 50000 });
        `;

        const features = extractor.extract(code);

        expect(features.signals.maxLimit).toBe(50000);
      });

      it('should calculate tool call density', () => {
        const code = `
          const a = await callTool('a', {});
          const b = await callTool('b', {});
        `;

        const features = extractor.extract(code);

        expect(features.signals.toolCallDensity).toBeGreaterThan(0);
      });

      it('should calculate fan-out risk', () => {
        const code = `
          for (const item of items) {
            await callTool('process:item', {});
            await callTool('notify:item', {});
          }
        `;

        const features = extractor.extract(code);

        expect(features.signals.fanOutRisk).toBeGreaterThan(0);
      });
    });

    describe('extraction metadata', () => {
      it('should include extraction time', () => {
        const code = `const x = 1;`;
        const features = extractor.extract(code);

        expect(features.meta.extractionTimeMs).toBeGreaterThanOrEqual(0);
      });

      it('should include code hash', () => {
        const code = `const x = 1;`;
        const features = extractor.extract(code);

        expect(features.meta.codeHash).toBeDefined();
        expect(features.meta.codeHash.length).toBeGreaterThan(0);
      });

      it('should produce same hash for same code', () => {
        const code = `const x = 1;`;
        const features1 = extractor.extract(code);
        const features2 = extractor.extract(code);

        expect(features1.meta.codeHash).toBe(features2.meta.codeHash);
      });

      it('should include line count', () => {
        const code = `
          const a = 1;
          const b = 2;
          const c = 3;
        `;
        const features = extractor.extract(code);

        expect(features.meta.lineCount).toBe(5);
      });
    });

    describe('edge cases', () => {
      it('should handle empty code', () => {
        const features = extractor.extract('');

        expect(features.toolCalls.length).toBe(0);
        expect(features.patterns.totalToolCalls).toBe(0);
      });

      it('should handle code without tool calls', () => {
        const code = `
          const x = 1 + 2;
          console.log(x);
        `;

        const features = extractor.extract(code);

        expect(features.toolCalls.length).toBe(0);
      });

      it('should handle invalid syntax gracefully', () => {
        const code = `this is not valid javascript {{{`;

        const features = extractor.extract(code);

        // Should not throw, should return empty features
        expect(features.toolCalls.length).toBe(0);
      });
    });
  });

  describe('static helpers', () => {
    describe('detectExfiltrationPattern()', () => {
      it('should detect list→send pattern', () => {
        const sequence = ['users:list', 'emails:send'];
        expect(FeatureExtractor.detectExfiltrationPattern(sequence)).toBe(true);
      });

      it('should detect query→export pattern', () => {
        const sequence = ['data:query', 'files:export'];
        expect(FeatureExtractor.detectExfiltrationPattern(sequence)).toBe(true);
      });

      it('should not detect safe patterns', () => {
        const sequence = ['users:get', 'users:update'];
        expect(FeatureExtractor.detectExfiltrationPattern(sequence)).toBe(false);
      });

      it('should handle empty sequence', () => {
        expect(FeatureExtractor.detectExfiltrationPattern([])).toBe(false);
      });

      it('should handle single tool', () => {
        expect(FeatureExtractor.detectExfiltrationPattern(['users:list'])).toBe(false);
      });
    });

    describe('isBulkOperation()', () => {
      it('should detect bulk operation names', () => {
        expect(FeatureExtractor.isBulkOperation('users:bulkCreate')).toBe(true);
        expect(FeatureExtractor.isBulkOperation('data:batchProcess')).toBe(true);
        expect(FeatureExtractor.isBulkOperation('files:massDelete')).toBe(true);
      });

      it('should not flag normal operations', () => {
        expect(FeatureExtractor.isBulkOperation('users:get')).toBe(false);
        expect(FeatureExtractor.isBulkOperation('users:list')).toBe(false);
      });
    });

    describe('isSendOperation()', () => {
      it('should detect send operation names', () => {
        expect(FeatureExtractor.isSendOperation('emails:send')).toBe(true);
        expect(FeatureExtractor.isSendOperation('webhooks:post')).toBe(true);
        expect(FeatureExtractor.isSendOperation('notifications:notify')).toBe(true);
      });

      it('should not flag non-send operations', () => {
        expect(FeatureExtractor.isSendOperation('users:list')).toBe(false);
        expect(FeatureExtractor.isSendOperation('data:get')).toBe(false);
      });
    });
  });
});

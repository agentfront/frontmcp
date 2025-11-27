/**
 * Enclave Sidecar Integration Tests
 *
 * Tests for the full end-to-end pass-by-reference flow:
 * - Large string extraction from code
 * - Reference resolution at callTool boundary
 * - Large result lifting back to sidecar
 * - Concatenation handling
 */

import { Enclave } from '../enclave';
import { isReferenceId } from '../sidecar/reference-config';

describe('Enclave Sidecar Integration', () => {
  describe('with sidecar enabled', () => {
    it('should extract large strings from code', async () => {
      const largeString = 'x'.repeat(100);
      let capturedArgs: Record<string, unknown> = {};

      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        sidecar: {
          enabled: true,
          extractionThreshold: 50, // Low threshold for testing
        },
        toolHandler: async (name, args) => {
          capturedArgs = args;
          return 'ok';
        },
      });

      try {
        const result = await enclave.run(`
          const data = "${largeString}";
          await callTool('myTool', { content: data });
        `);

        expect(result.success).toBe(true);
        // The tool should receive the actual string (resolved from reference)
        expect(capturedArgs['content']).toBe(largeString);
      } finally {
        enclave.dispose();
      }
    });

    it('should lift large tool results to sidecar', async () => {
      const largeResult = 'y'.repeat(100000); // 100KB - above threshold

      const enclave = new Enclave({
        securityLevel: 'STRICT',
        sidecar: {
          enabled: true,
          extractionThreshold: 64 * 1024, // 64KB
        },
        toolHandler: async () => largeResult,
      });

      try {
        const result = await enclave.run(`
          const data = await callTool('getData', {});
          return data;
        `);

        expect(result.success).toBe(true);
        // The result should be a reference ID (not the actual data)
        expect(isReferenceId(result.value)).toBe(true);
      } finally {
        enclave.dispose();
      }
    });

    it('should pass through small results without lifting', async () => {
      const smallResult = 'small data';

      const enclave = new Enclave({
        securityLevel: 'STRICT',
        sidecar: {
          enabled: true,
          extractionThreshold: 64 * 1024,
        },
        toolHandler: async () => smallResult,
      });

      try {
        const result = await enclave.run(`
          return await callTool('getData', {});
        `);

        expect(result.success).toBe(true);
        expect(result.value).toBe(smallResult);
      } finally {
        enclave.dispose();
      }
    });

    it('should handle concatenation with composites disabled (STRICT)', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        sidecar: {
          enabled: true,
          extractionThreshold: 50,
          allowComposites: false,
        },
        toolHandler: async () => 'ok',
      });

      try {
        const largeString = 'z'.repeat(100);
        // This code tries to concatenate a large string (which becomes a reference)
        // with another string, which should throw when composites are disabled
        const result = await enclave.run(`
          const data = "${largeString}";
          const combined = data + " suffix";
          return combined;
        `);

        // Should fail due to reference concatenation being blocked
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Cannot concatenate');
      } finally {
        enclave.dispose();
      }
    });

    it('should handle concatenation with composites enabled (STANDARD)', async () => {
      let capturedArgs: Record<string, unknown> = {};

      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        sidecar: {
          enabled: true,
          extractionThreshold: 50,
          allowComposites: true,
        },
        toolHandler: async (name, args) => {
          capturedArgs = args;
          return 'ok';
        },
      });

      try {
        const largeString = 'z'.repeat(100);
        // This code concatenates a large string with another string
        // The composite should be resolved at callTool boundary
        const result = await enclave.run(`
          const data = "${largeString}";
          const combined = data + " suffix";
          await callTool('myTool', { content: combined });
        `);

        expect(result.success).toBe(true);
        // The resolved value should be the concatenated string
        expect(capturedArgs['content']).toBe(largeString + ' suffix');
      } finally {
        enclave.dispose();
      }
    });

    it('should resolve nested references in objects', async () => {
      let capturedArgs: Record<string, unknown> = {};
      const largeString1 = 'a'.repeat(100);
      const largeString2 = 'b'.repeat(100);

      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        sidecar: {
          enabled: true,
          extractionThreshold: 50,
        },
        toolHandler: async (name, args) => {
          capturedArgs = args;
          return 'ok';
        },
      });

      try {
        const result = await enclave.run(`
          const data1 = "${largeString1}";
          const data2 = "${largeString2}";
          await callTool('myTool', {
            nested: {
              first: data1,
              second: data2
            }
          });
        `);

        expect(result.success).toBe(true);
        const nested = capturedArgs['nested'] as Record<string, string>;
        expect(nested['first']).toBe(largeString1);
        expect(nested['second']).toBe(largeString2);
      } finally {
        enclave.dispose();
      }
    });

    it('should fail fast on predictive expansion check', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        sidecar: {
          enabled: true,
          extractionThreshold: 50,
          maxResolvedSize: 100, // Very small limit
        },
        toolHandler: async () => 'ok',
      });

      try {
        const largeString = 'x'.repeat(200);
        const result = await enclave.run(`
          const data = "${largeString}";
          await callTool('myTool', { content: data });
        `);

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('exceed maximum resolved size');
      } finally {
        enclave.dispose();
      }
    });

    it('should dispose sidecar after execution', async () => {
      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        sidecar: {
          enabled: true,
          extractionThreshold: 50,
        },
        toolHandler: async () => 'ok',
      });

      try {
        // Run multiple times to ensure sidecar is created fresh each time
        for (let i = 0; i < 3; i++) {
          const result = await enclave.run(`
            const data = "${'x'.repeat(100)}";
            await callTool('myTool', { content: data });
          `);
          expect(result.success).toBe(true);
        }
      } finally {
        enclave.dispose();
      }
    });
  });

  describe('without sidecar', () => {
    it('should work normally', async () => {
      let capturedArgs: Record<string, unknown> = {};

      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        toolHandler: async (name, args) => {
          capturedArgs = args;
          return 'result';
        },
      });

      try {
        const result = await enclave.run(`
          const value = "hello world";
          const toolResult = await callTool('myTool', { msg: value });
          return toolResult;
        `);

        expect(result.success).toBe(true);
        expect(result.value).toBe('result');
        expect(capturedArgs['msg']).toBe('hello world');
      } finally {
        enclave.dispose();
      }
    });
  });
});

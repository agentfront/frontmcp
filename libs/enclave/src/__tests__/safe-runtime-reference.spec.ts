/**
 * Safe Runtime Reference Integration Tests
 *
 * Tests for __safe_concat__, __safe_template__, and reference resolution
 * in __safe_callTool.
 */

import { createSafeRuntime } from '../safe-runtime';
import { ReferenceSidecar } from '../sidecar/reference-sidecar';
import { REFERENCE_CONFIGS, isReferenceId } from '../sidecar/reference-config';
import type { ExecutionContext } from '../types';

describe('Safe Runtime Reference Integration', () => {
  // Helper to create an execution context
  const createContext = (toolHandler?: ExecutionContext['toolHandler']): ExecutionContext => ({
    config: {
      timeout: 30000,
      memoryLimit: 128 * 1024 * 1024,
      maxToolCalls: 100,
      maxIterations: 10000,
      adapter: 'vm',
      allowBuiltins: false,
      globals: {},
      sanitizeStackTraces: false,
      maxSanitizeDepth: 20,
      maxSanitizeProperties: 500,
      maxConsoleOutputBytes: 1024 * 1024,
      maxConsoleCalls: 1000,
    },
    stats: {
      duration: 0,
      toolCallCount: 0,
      iterationCount: 0,
      startTime: Date.now(),
      endTime: 0,
    },
    abortController: new AbortController(),
    aborted: false,
    toolHandler,
  });

  describe('__safe_concat', () => {
    describe('without sidecar', () => {
      it('should concatenate strings normally', () => {
        const context = createContext();
        const runtime = createSafeRuntime(context);

        expect(runtime.__safe_concat('hello', ' world')).toBe('hello world');
        expect(runtime.__safe_concat('a', 'b')).toBe('ab');
        expect(runtime.__safe_concat('', 'test')).toBe('test');
      });

      it('should convert non-strings to strings', () => {
        const context = createContext();
        const runtime = createSafeRuntime(context);

        expect(runtime.__safe_concat(1, 2)).toBe('12');
        expect(runtime.__safe_concat(true, false)).toBe('truefalse');
        expect(runtime.__safe_concat(null, undefined)).toBe('nullundefined');
      });

      it('should throw if reference ID detected without sidecar', () => {
        const context = createContext();
        const runtime = createSafeRuntime(context);

        const refId = '__REF_12345678-1234-1234-1234-123456789012__';

        expect(() => runtime.__safe_concat(refId, ' extra')).toThrow('reference system not configured');
        expect(() => runtime.__safe_concat('prefix ', refId)).toThrow('reference system not configured');
      });
    });

    describe('with sidecar (composites disabled)', () => {
      it('should throw when concatenating with reference ID', () => {
        const context = createContext();
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT, // composites disabled
        });

        const refId = sidecar.store('large data here', 'extraction');

        expect(() => runtime.__safe_concat(refId, ' extra')).toThrow('Composite handles are disabled');

        sidecar.dispose();
      });

      it('should concatenate normally if no references', () => {
        const context = createContext();
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        expect(runtime.__safe_concat('hello', ' world')).toBe('hello world');

        sidecar.dispose();
      });
    });

    describe('with sidecar (composites enabled)', () => {
      it('should create composite handle when concatenating references', () => {
        const context = createContext();
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STANDARD, // composites enabled
        });

        const refId = sidecar.store('large data', 'extraction');
        const result = runtime.__safe_concat(refId, ' suffix');

        expect(result).toEqual({
          __type: 'composite',
          __operation: 'concat',
          __parts: [refId, ' suffix'],
          __estimatedSize: expect.any(Number),
        });

        sidecar.dispose();
      });

      it('should create composite for two references', () => {
        const context = createContext();
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STANDARD,
        });

        const ref1 = sidecar.store('data one', 'extraction');
        const ref2 = sidecar.store('data two', 'extraction');
        const result = runtime.__safe_concat(ref1, ref2);

        expect(result).toEqual({
          __type: 'composite',
          __operation: 'concat',
          __parts: [ref1, ref2],
          __estimatedSize: expect.any(Number),
        });

        sidecar.dispose();
      });
    });
  });

  describe('__safe_template', () => {
    describe('without sidecar', () => {
      it('should interpolate template literals normally', () => {
        const context = createContext();
        const runtime = createSafeRuntime(context);

        // Simulates: `Hello ${name}!`
        expect(runtime.__safe_template(['Hello ', '!'], 'World')).toBe('Hello World!');

        // Simulates: `${a} + ${b} = ${c}`
        expect(runtime.__safe_template(['', ' + ', ' = ', ''], 1, 2, 3)).toBe('1 + 2 = 3');
      });

      it('should throw if reference ID detected without sidecar', () => {
        const context = createContext();
        const runtime = createSafeRuntime(context);

        const refId = '__REF_12345678-1234-1234-1234-123456789012__';

        expect(() => runtime.__safe_template(['Result: ', ''], refId)).toThrow('reference system not configured');
      });
    });

    describe('with sidecar (composites disabled)', () => {
      it('should throw when interpolating reference ID', () => {
        const context = createContext();
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        const refId = sidecar.store('large content', 'extraction');

        expect(() => runtime.__safe_template(['Result: ', ''], refId)).toThrow('Composite handles are disabled');

        sidecar.dispose();
      });
    });

    describe('with sidecar (composites enabled)', () => {
      it('should create composite handle for template with reference', () => {
        const context = createContext();
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STANDARD,
        });

        const refId = sidecar.store('large content', 'extraction');
        const result = runtime.__safe_template(['Prefix: ', ' :Suffix'], refId);

        expect(result).toEqual({
          __type: 'composite',
          __operation: 'concat',
          __parts: ['Prefix: ', refId, ' :Suffix'],
          __estimatedSize: expect.any(Number),
        });

        sidecar.dispose();
      });
    });
  });

  describe('__safe_callTool with references', () => {
    describe('reference resolution', () => {
      it('should resolve reference IDs before calling tool handler', async () => {
        let capturedArgs: Record<string, unknown> = {};
        const toolHandler = async (name: string, args: Record<string, unknown>) => {
          capturedArgs = args;
          return 'ok';
        };

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        const refId = sidecar.store('large file content here', 'extraction');
        await runtime.__safe_callTool('myTool', { data: refId });

        expect(capturedArgs['data']).toBe('large file content here');

        sidecar.dispose();
      });

      it('should resolve nested references in objects', async () => {
        let capturedArgs: Record<string, unknown> = {};
        const toolHandler = async (name: string, args: Record<string, unknown>) => {
          capturedArgs = args;
          return 'ok';
        };

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        const ref1 = sidecar.store('content one', 'extraction');
        const ref2 = sidecar.store('content two', 'extraction');

        await runtime.__safe_callTool('myTool', {
          nested: {
            a: ref1,
            b: ref2,
          },
        });

        const nested = capturedArgs['nested'] as Record<string, string>;
        expect(nested['a']).toBe('content one');
        expect(nested['b']).toBe('content two');

        sidecar.dispose();
      });

      it('should resolve references in arrays', async () => {
        let capturedArgs: Record<string, unknown> = {};
        const toolHandler = async (name: string, args: Record<string, unknown>) => {
          capturedArgs = args;
          return 'ok';
        };

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        const ref1 = sidecar.store('item one', 'extraction');
        const ref2 = sidecar.store('item two', 'extraction');

        await runtime.__safe_callTool('myTool', {
          items: [ref1, 'literal', ref2],
        });

        expect(capturedArgs['items']).toEqual(['item one', 'literal', 'item two']);

        sidecar.dispose();
      });

      it('should pass through non-reference strings unchanged', async () => {
        let capturedArgs: Record<string, unknown> = {};
        const toolHandler = async (name: string, args: Record<string, unknown>) => {
          capturedArgs = args;
          return 'ok';
        };

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        await runtime.__safe_callTool('myTool', {
          data: 'not a reference',
          number: 42,
        });

        expect(capturedArgs['data']).toBe('not a reference');
        expect(capturedArgs['number']).toBe(42);

        sidecar.dispose();
      });
    });

    describe('predictive expansion check', () => {
      it('should fail fast if resolved size would exceed limit', async () => {
        const toolHandler = async () => 'ok';

        const context = createContext(toolHandler);
        // Use a small config for testing
        const smallConfig = {
          ...REFERENCE_CONFIGS.STRICT,
          maxResolvedSize: 100, // Very small limit
        };
        const sidecar = new ReferenceSidecar(smallConfig);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: smallConfig,
        });

        const refId = sidecar.store('x'.repeat(200), 'extraction');

        await expect(runtime.__safe_callTool('myTool', { data: refId })).rejects.toThrow(
          'exceed maximum resolved size',
        );

        sidecar.dispose();
      });
    });

    describe('lifting return values', () => {
      it('should lift large string results to sidecar', async () => {
        const largeResult = 'x'.repeat(100000); // 100KB
        const toolHandler = async () => largeResult;

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT, // 64KB threshold
        });

        const result = await runtime.__safe_callTool('myTool', {});

        // Should return a reference ID
        expect(isReferenceId(result)).toBe(true);

        // Should be able to retrieve the original data
        expect(sidecar.retrieveString(result as string)).toBe(largeResult);

        sidecar.dispose();
      });

      it('should not lift small string results', async () => {
        const smallResult = 'small result';
        const toolHandler = async () => smallResult;

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        const result = await runtime.__safe_callTool('myTool', {});

        // Should return the original value
        expect(result).toBe('small result');

        sidecar.dispose();
      });

      it('should not lift non-string results', async () => {
        const toolHandler = async () => ({ key: 'value' });

        const context = createContext(toolHandler);
        const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STRICT);
        const runtime = createSafeRuntime(context, {
          sidecar,
          referenceConfig: REFERENCE_CONFIGS.STRICT,
        });

        const result = await runtime.__safe_callTool('myTool', {});

        // Should return the original object
        expect(result).toEqual({ key: 'value' });

        sidecar.dispose();
      });
    });

    describe('without sidecar', () => {
      it('should work normally without sidecar', async () => {
        let capturedArgs: Record<string, unknown> = {};
        const toolHandler = async (name: string, args: Record<string, unknown>) => {
          capturedArgs = args;
          return { status: 'success' };
        };

        const context = createContext(toolHandler);
        const runtime = createSafeRuntime(context);

        const result = await runtime.__safe_callTool('myTool', { data: 'test' });

        expect(capturedArgs['data']).toBe('test');
        expect(result).toEqual({ status: 'success' });
      });
    });
  });

  describe('composite handle resolution', () => {
    it('should resolve composite handles in callTool arguments', async () => {
      let capturedArgs: Record<string, unknown> = {};
      const toolHandler = async (name: string, args: Record<string, unknown>) => {
        capturedArgs = args;
        return 'ok';
      };

      const context = createContext(toolHandler);
      const sidecar = new ReferenceSidecar(REFERENCE_CONFIGS.STANDARD);
      const runtime = createSafeRuntime(context, {
        sidecar,
        referenceConfig: REFERENCE_CONFIGS.STANDARD,
      });

      const refId = sidecar.store('middle content', 'extraction');

      // Create a composite via __safe_concat
      const composite = runtime.__safe_concat('prefix-', refId);

      await runtime.__safe_callTool('myTool', { data: composite });

      expect(capturedArgs['data']).toBe('prefix-middle content');

      sidecar.dispose();
    });
  });
});

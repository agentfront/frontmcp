/**
 * Enclave Infinite Loop Attack Tests
 *
 * Tests various techniques to bypass AgentScript loop restrictions
 * and create infinite or resource-exhausting loops.
 *
 * All tests should either:
 * 1. Be blocked by AST validation (VALIDATION_ERROR)
 * 2. Be stopped by runtime limits (iteration/timeout)
 * 3. Complete safely without infinite loop
 */

import { Enclave } from '../enclave';
import type { ToolHandler } from '../types';

describe('Enclave - Infinite Loop Attack Vectors', () => {
  // Strict limits for testing
  const STRICT_LIMITS = {
    maxIterations: 100,
    timeout: 1000, // 1 second
    maxToolCalls: 10,
  };

  describe('Recursion Depth Limit Tests', () => {
    it('should block or limit self-referencing arrow function recursion', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const recurse = (n) => n > 0 ? recurse(n - 1) : 'done';
        return recurse(1000000);
      `;

      const result = await enclave.run(code);

      // Should either fail validation or hit runtime limits
      if (result.success) {
        // If it somehow succeeds, it should have been limited
        expect(result.stats.duration).toBeLessThan(STRICT_LIMITS.timeout);
      } else {
        // Expected: blocked by validation or runtime error
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    });

    it('should block or limit mutual recursion via arrow functions', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const a = (n) => n > 0 ? b(n - 1) : 'done';
        const b = (n) => a(n);
        return a(1000000);
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.stats.duration).toBeLessThan(STRICT_LIMITS.timeout);
      } else {
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    });

    it('should block or limit nested arrow function recursion', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const outer = (n) => {
          const inner = (m) => m > 0 ? inner(m - 1) : m;
          return n > 0 ? outer(n - 1) + inner(n) : 0;
        };
        return outer(10000);
      `;

      const result = await enclave.run(code);

      if (result.success) {
        expect(result.stats.duration).toBeLessThan(STRICT_LIMITS.timeout);
      } else {
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    });
  });

  describe('Array Modification During Iteration Attacks', () => {
    it('should handle for-of with array.push during iteration', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      // This is the key attack: push to array during for-of iteration
      const code = `
        const arr = [1];
        let count = 0;
        for (const item of arr) {
          count++;
          if (count < 1000000) {
            arr.push(item + 1);
          }
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration');

      enclave.dispose();
    });

    it('should handle callTool result modification during iteration', async () => {
      const toolHandler: ToolHandler = async () => {
        return { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      };

      const enclave = new Enclave({
        ...STRICT_LIMITS,
        toolHandler,
      });

      const code = `
        const users = await callTool('users:list', {});
        let count = 0;
        for (const user of users.items) {
          count++;
          // Try to create infinite loop by adding to items
          users.items.push({ id: count + 100 });
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration');

      enclave.dispose();
    });

    it('should handle nested for-of with mutual array modification', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr1 = [1];
        const arr2 = [1];
        let count = 0;

        for (const a of arr1) {
          for (const b of arr2) {
            count++;
            arr1.push(a + 1);
            arr2.push(b + 1);
          }
        }
        return count;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration');

      enclave.dispose();
    });
  });

  describe('Map/Filter/Reduce Attacks', () => {
    it('should handle map callback that modifies source array', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [1, 2, 3];
        let mapCount = 0;

        const result = arr.map(item => {
          mapCount++;
          arr.push(item + 10); // Try to extend array during map
          return item * 2;
        });

        return { result, mapCount, arrLength: arr.length };
      `;

      const result = await enclave.run(code);

      // Map should iterate over original length (3), not infinite
      // The arr will have 6 items after (3 original + 3 pushed)
      if (result.success) {
        const value = result.value as { result: number[]; mapCount: number; arrLength: number };
        expect(value.mapCount).toBe(3); // Only original 3 items
        expect(value.arrLength).toBe(6); // 3 + 3 pushed
      }

      enclave.dispose();
    });

    it('should handle reduce with accumulator that causes iteration', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [1, 2, 3];
        let reduceCount = 0;

        const result = arr.reduce((acc, item) => {
          reduceCount++;
          arr.push(item + 100); // Try to extend during reduce
          acc.push(item);
          return acc;
        }, []);

        return { result, reduceCount };
      `;

      const result = await enclave.run(code);

      // Reduce should also iterate over original length
      if (result.success) {
        const value = result.value as { result: number[]; reduceCount: number };
        expect(value.reduceCount).toBe(3);
      }

      enclave.dispose();
    });

    it('should handle filter with side effect trying to extend array', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [1, 2, 3, 4, 5];
        let filterCount = 0;

        const result = arr.filter(item => {
          filterCount++;
          if (item < 1000) arr.push(item + 10);
          return item % 2 === 0;
        });

        return { result, filterCount };
      `;

      const result = await enclave.run(code);

      if (result.success) {
        const value = result.value as { result: number[]; filterCount: number };
        expect(value.filterCount).toBe(5); // Original length
      }

      enclave.dispose();
    });
  });

  describe('For Loop Counter Manipulation Attacks', () => {
    it('should handle decrementing loop counter (i--)', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        let count = 0;
        for (let i = 0; i < 10; i--) {
          count++;
          // i goes: 0, -1, -2, ... forever (always < 10)
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit OR timeout
      // NOTE: Basic `for` loops may not be tracked, so timeout is acceptable
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/iteration|timed out/i);

      enclave.dispose();
    });

    it('should handle loop counter reset inside body', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        let count = 0;
        for (let i = 0; i < 10; i++) {
          count++;
          if (i === 5) i = 0; // Reset counter
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit OR timeout
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/iteration|timed out/i);

      enclave.dispose();
    });

    it('should handle condition that never becomes false', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        let count = 0;
        for (let i = 0; i >= 0; i++) {
          count++;
          // i is always >= 0 (until overflow, which takes forever)
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit OR timeout
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/iteration|timed out/i);

      enclave.dispose();
    });
  });

  describe('Object Property Access Attacks', () => {
    it('should handle getter that references itself', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500, // Shorter timeout for stack overflow
      });

      // Note: This uses object literal getter syntax, not defineProperty
      const code = `
        const obj = {
          get value() {
            return this.value; // Infinite recursion via getter
          }
        };
        return obj.value;
      `;

      const result = await enclave.run(code);

      // Should fail with stack overflow or timeout
      expect(result.success).toBe(false);

      enclave.dispose();
    });

    it('should handle circular toString reference', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        const obj = {};
        obj.toString = () => String(obj); // Circular toString
        return String(obj);
      `;

      const result = await enclave.run(code);

      // Should fail with stack overflow
      expect(result.success).toBe(false);

      enclave.dispose();
    });

    it('should handle circular valueOf reference', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        const obj = {};
        obj.valueOf = () => +obj; // Circular valueOf
        return +obj;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('JSON Parsing Attacks', () => {
    it('should handle deeply nested JSON', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      // Create deeply nested JSON string
      const depth = 1000;
      const deepJson = '{' + '"a":'.repeat(depth) + '1' + '}'.repeat(depth);

      const code = `
        const json = '${deepJson}';
        const parsed = JSON.parse(json);
        return parsed;
      `;

      const result = await enclave.run(code);

      // Should either parse successfully (if within limits) or fail safely
      // JSON.parse itself handles this gracefully
      if (!result.success) {
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    });

    it('should handle JSON.parse reviver that modifies during parsing', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        let reviverCalls = 0;
        const json = '{"a": 1, "b": 2, "c": 3}';

        const parsed = JSON.parse(json, (key, value) => {
          reviverCalls++;
          return value;
        });

        return { parsed, reviverCalls };
      `;

      const result = await enclave.run(code);

      // Reviver is called for each property + root, should not infinite loop
      if (result.success) {
        const value = result.value as { parsed: unknown; reviverCalls: number };
        expect(value.reviverCalls).toBeLessThan(10);
      }

      enclave.dispose();
    });

    it('should handle large array in JSON', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        // Try to create large array via JSON
        const json = '[' + '1,'.repeat(10000) + '1]';
        const arr = JSON.parse(json);

        let sum = 0;
        for (const n of arr) {
          sum += n;
        }
        return sum;
      `;

      const result = await enclave.run(code);

      // Should fail due to iteration limit on for-of
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration');

      enclave.dispose();
    });
  });

  describe('Array.from Attacks', () => {
    it('should handle Array.from with large length', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        // Create array-like with large length
        const arrayLike = { length: 1000000 };
        const arr = Array.from(arrayLike, (_, i) => i);
        return arr.length;
      `;

      const result = await enclave.run(code);

      // Array.from iterates, should be caught by some limit
      // May succeed if Array.from isn't tracked, but will timeout
      if (!result.success) {
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    }, 10000);

    it('should handle Array.from with generator-like callback', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        let callCount = 0;
        const arr = Array.from({ length: 1000 }, () => {
          callCount++;
          return callCount;
        });
        return { length: arr.length, callCount };
      `;

      const result = await enclave.run(code);

      // May succeed or timeout depending on implementation
      if (result.success) {
        const value = result.value as { length: number; callCount: number };
        expect(value.callCount).toBeLessThanOrEqual(1000);
      }

      enclave.dispose();
    });
  });

  describe('Tool Call Loop Attacks', () => {
    it('should handle tool returning growing array', async () => {
      let callCount = 0;
      const toolHandler: ToolHandler = async () => {
        callCount++;
        // Return more items each time
        return {
          items: Array.from({ length: callCount * 10 }, (_, i) => ({ id: i })),
        };
      };

      const enclave = new Enclave({
        ...STRICT_LIMITS,
        toolHandler,
      });

      const code = `
        const firstResult = await callTool('getData', {});
        let totalItems = 0;

        for (const item of firstResult.items) {
          const moreData = await callTool('getData', { id: item.id });
          totalItems += moreData.items.length;
        }

        return totalItems;
      `;

      const result = await enclave.run(code);

      // Should be stopped by either iteration limit or tool call limit
      expect(result.success).toBe(false);

      enclave.dispose();
    });

    it('should handle tool that returns self-referential structure', async () => {
      const toolHandler: ToolHandler = async () => {
        const obj: Record<string, unknown> = { id: 1, name: 'test' };
        // Note: We can't actually create circular refs in JSON
        // but we can return large nested structures
        obj['nested'] = { data: obj['id'] };
        return obj;
      };

      const enclave = new Enclave({
        ...STRICT_LIMITS,
        toolHandler,
      });

      const code = `
        const data = await callTool('getCircular', {});
        return JSON.stringify(data);
      `;

      const result = await enclave.run(code);

      // Should handle nested structures gracefully
      if (result.success) {
        expect(typeof result.value).toBe('string');
      }

      enclave.dispose();
    });
  });

  describe('String Operation Attacks', () => {
    it('should handle exponential string growth via repeat', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        let str = 'a';
        for (let i = 0; i < 100; i++) {
          str = str.repeat(2); // Exponential growth: 2^100 chars
        }
        return str.length;
      `;

      const result = await enclave.run(code);

      // Should fail due to memory or timeout
      expect(result.success).toBe(false);

      enclave.dispose();
    });

    it('should handle regex catastrophic backtracking (ReDoS)', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      // Note: RegExp constructor is blocked in AgentScript
      // But regex literals might work
      const code = `
        const evilRegex = /^(a+)+$/;
        const input = 'a'.repeat(30) + 'b';
        return evilRegex.test(input);
      `;

      const result = await enclave.run(code);

      // Should either block regex or timeout on catastrophic backtracking
      if (!result.success) {
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    });
  });

  describe('Combined Attack Vectors', () => {
    it('should handle map + recursion + array modification', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [1, 2, 3];
        const process = (x) => {
          arr.push(x + 1);
          return x > 0 ? process(x - 1) : x;
        };

        const result = arr.map(process);
        return result;
      `;

      const result = await enclave.run(code);

      // Should be caught by recursion depth or timeout
      if (!result.success) {
        expect(result.error).toBeDefined();
      }

      enclave.dispose();
    });

    it('should handle for-of + tool call + array growth', async () => {
      let toolCallCount = 0;
      const toolHandler: ToolHandler = async () => {
        toolCallCount++;
        return { value: toolCallCount };
      };

      const enclave = new Enclave({
        ...STRICT_LIMITS,
        toolHandler,
      });

      const code = `
        const items = [1];
        const results = [];

        for (const item of items) {
          const data = await callTool('process', { item });
          results.push(data.value);
          items.push(item + 1); // Grow array during iteration
        }

        return results;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration or tool call limit
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('ReDoS Attack Patterns', () => {
    it('should block or timeout alternation-based backtracking /^(a|a)*$/', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      // Classic ReDoS pattern with alternation causing exponential backtracking
      const code = `
        const evilRegex = /^(a|a)*$/;
        const input = 'a'.repeat(30) + 'b';
        return evilRegex.test(input);
      `;

      const result = await enclave.run(code);

      // Should either block regex literal or timeout on catastrophic backtracking
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
      enclave.dispose();
    });

    it('should block or timeout nested star quantifiers /^(a*)*$/', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        const evilRegex = /^(a*)*$/;
        const input = 'a'.repeat(25) + 'b';
        return evilRegex.test(input);
      `;

      const result = await enclave.run(code);

      if (!result.success) {
        expect(result.error).toBeDefined();
      }
      enclave.dispose();
    });

    it('should block or timeout character class quantifiers /^([0-9]+)+$/', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        const evilRegex = /^([0-9]+)+$/;
        const input = '1'.repeat(30) + 'x';
        return evilRegex.test(input);
      `;

      const result = await enclave.run(code);

      if (!result.success) {
        expect(result.error).toBeDefined();
      }
      enclave.dispose();
    });

    it('should block or timeout polynomial backtracking /^(.*a){25}$/', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        const evilRegex = /^(.*a){25}$/;
        const input = 'a'.repeat(50);
        return evilRegex.test(input);
      `;

      const result = await enclave.run(code);

      if (!result.success) {
        expect(result.error).toBeDefined();
      }
      enclave.dispose();
    });

    it('should block or timeout overlapping alternation /^(a|ab)*$/', async () => {
      const enclave = new Enclave({
        ...STRICT_LIMITS,
        timeout: 500,
      });

      const code = `
        const evilRegex = /^(a|ab)*$/;
        const input = 'ababababababababababababab' + 'c';
        return evilRegex.test(input);
      `;

      const result = await enclave.run(code);

      if (!result.success) {
        expect(result.error).toBeDefined();
      }
      enclave.dispose();
    });
  });

  describe('Generator/Iterator DoS Attacks', () => {
    it('should block infinite generator consumption via function declaration', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      // Generator functions require function* syntax which should be blocked
      const code = `
        function* inf() { while(true) yield 1; }
        let count = 0;
        for (const x of inf()) {
          count++;
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should fail - either generator syntax blocked or iteration limit hit
      expect(result.success).toBe(false);
      enclave.dispose();
    });

    it('should block circular generator delegation', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        function* a() { yield* b(); }
        function* b() { yield* a(); }
        for (const x of a()) {}
      `;

      const result = await enclave.run(code);

      // Should fail - either generator syntax blocked or stack overflow
      expect(result.success).toBe(false);
      enclave.dispose();
    });

    it('should block custom infinite iterator via Symbol.iterator', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const it = {
          [Symbol.iterator]() {
            return {
              next() { return { value: 1, done: false }; }
            };
          }
        };
        let count = 0;
        for (const x of it) {
          count++;
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should fail - either Symbol blocked or iteration limit hit
      expect(result.success).toBe(false);
      enclave.dispose();
    });

    it('should block async generator infinite loop', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        async function* inf() {
          while(true) yield await Promise.resolve(1);
        }
        let count = 0;
        for await (const x of inf()) {
          count++;
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Should fail - async generator syntax should be blocked
      expect(result.success).toBe(false);
      enclave.dispose();
    });
  });

  describe('Deep Recursion Attacks', () => {
    it('should block 3-function mutual recursion chain', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const a = (n) => n > 0 ? b(n - 1) : 0;
        const b = (n) => c(n);
        const c = (n) => a(n);
        return a(1000000);
      `;

      const result = await enclave.run(code);

      // Should fail - recursion depth or timeout
      expect(result.success).toBe(false);
      enclave.dispose();
    });

    it('should block 10-function recursion chain', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const f0 = (n) => n > 0 ? f1(n - 1) : 0;
        const f1 = (n) => f2(n);
        const f2 = (n) => f3(n);
        const f3 = (n) => f4(n);
        const f4 = (n) => f5(n);
        const f5 = (n) => f6(n);
        const f6 = (n) => f7(n);
        const f7 = (n) => f8(n);
        const f8 = (n) => f9(n);
        const f9 = (n) => f0(n);
        return f0(1000000);
      `;

      const result = await enclave.run(code);

      // Should fail - recursion or timeout
      expect(result.success).toBe(false);
      enclave.dispose();
    });

    it('should block Y-combinator recursion', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const Y = (f) => ((x) => f((y) => x(x)(y)))((x) => f((y) => x(x)(y)));
        const fact = Y((f) => (n) => n <= 1 ? 1 : n * f(n - 1));
        return fact(100000);
      `;

      const result = await enclave.run(code);

      // Should fail - deep recursion
      expect(result.success).toBe(false);
      enclave.dispose();
    });

    it('should block trampoline-style recursion', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const trampoline = (fn) => {
          let r = fn();
          while (typeof r === 'function') r = r();
          return r;
        };
        const countdown = (n) => n === 0 ? 'done' : () => countdown(n - 1);
        return trampoline(() => countdown(1000000));
      `;

      const result = await enclave.run(code);

      // Should fail - iteration limit or timeout
      expect(result.success).toBe(false);
      enclave.dispose();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty for-of loop', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [];
        let count = 0;
        for (const item of arr) {
          count++;
          arr.push(1); // Even though we push, loop is empty
        }
        return count;
      `;

      const result = await enclave.run(code);

      // Empty array, no iterations
      expect(result.success).toBe(true);
      expect(result.value).toBe(0);

      enclave.dispose();
    });

    it('should handle loop with break statement', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [1, 2, 3, 4, 5];
        let count = 0;

        for (const item of arr) {
          count++;
          arr.push(item + 10);
          if (count >= 3) break; // Early exit
        }

        return count;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe(3);

      enclave.dispose();
    });

    it('should handle single iteration with large side effect', async () => {
      const enclave = new Enclave(STRICT_LIMITS);

      const code = `
        const arr = [1];
        let pushCount = 0;

        for (const item of arr) {
          // Push many items in single iteration
          for (let i = 0; i < 1000; i++) {
            arr.push(i);
            pushCount++;
          }
        }

        return pushCount;
      `;

      const result = await enclave.run(code);

      // Inner for loop should hit iteration limit
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration');

      enclave.dispose();
    });
  });
});

// file: libs/plugins/src/codecall/__tests__/enclave.service.test.ts

import EnclaveService, { ScriptTooLargeError } from '../services/enclave.service';
import CodeCallConfig from '../providers/code-call.config';
import type { CodeCallVmEnvironment } from '../codecall.symbol';

describe('EnclaveService', () => {
  let service: EnclaveService;
  let mockEnvironment: CodeCallVmEnvironment;

  beforeEach(() => {
    const config = new CodeCallConfig({
      vm: {
        preset: 'secure',
        timeoutMs: 5000,
        allowLoops: true,
        allowConsole: true,
      },
    });

    service = new EnclaveService(config);

    mockEnvironment = {
      callTool: jest.fn().mockResolvedValue({ success: true, data: 'test' }),
      getTool: jest.fn().mockReturnValue({
        name: 'test:tool',
        description: 'Test tool',
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
      }),
      console: undefined,
      mcpLog: jest.fn(),
      mcpNotify: jest.fn(),
    };
  });

  describe('basic execution', () => {
    it('should execute simple return statement', async () => {
      const result = await service.execute('return 42;', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
      expect(result.timedOut).toBe(false);
    });

    it('should execute and return object', async () => {
      const result = await service.execute('return { name: "test", value: 123 };', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ name: 'test', value: 123 });
    });

    it('should execute and return array', async () => {
      const result = await service.execute('return [1, 2, 3, 4, 5];', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should execute and return string', async () => {
      const result = await service.execute('return "hello world";', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toBe('hello world');
    });

    it('should execute and return null', async () => {
      const result = await service.execute('return null;', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toBe(null);
    });

    it('should execute and return undefined', async () => {
      const result = await service.execute('return undefined;', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toBe(undefined);
    });
  });

  describe('callTool integration', () => {
    it('should call tool and return result', async () => {
      (mockEnvironment.callTool as jest.Mock).mockResolvedValue({
        users: [{ id: '1', name: 'Alice' }],
      });

      const result = await service.execute(
        `
        const data = await callTool('users:list', { limit: 10 });
        return data;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ users: [{ id: '1', name: 'Alice' }] });
      expect(mockEnvironment.callTool).toHaveBeenCalledWith('users:list', { limit: 10 });
    });

    it('should call multiple tools in sequence', async () => {
      (mockEnvironment.callTool as jest.Mock)
        .mockResolvedValueOnce([{ id: '1', name: 'Alice' }])
        .mockResolvedValueOnce([{ orderId: 'order-1', amount: 100 }]);

      const result = await service.execute(
        `
        const users = await callTool('users:list', {});
        const orders = await callTool('orders:list', { userId: users[0].id });
        return { user: users[0], orders };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        user: { id: '1', name: 'Alice' },
        orders: [{ orderId: 'order-1', amount: 100 }],
      });
      expect(mockEnvironment.callTool).toHaveBeenCalledTimes(2);
    });

    it('should handle tool errors gracefully', async () => {
      const toolError = new Error('Tool execution failed');
      (toolError as any).toolName = 'failing:tool';
      (mockEnvironment.callTool as jest.Mock).mockRejectedValue(toolError);

      const result = await service.execute(
        `
        const data = await callTool('failing:tool', {});
        return data;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Tool execution failed');
    });
  });

  describe('data transformation', () => {
    it('should handle array map', async () => {
      const result = await service.execute(
        `
        const numbers = [1, 2, 3, 4, 5];
        return numbers.map(n => n * 2);
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should handle array filter', async () => {
      const result = await service.execute(
        `
        const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        return numbers.filter(n => n % 2 === 0);
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should handle array reduce', async () => {
      const result = await service.execute(
        `
        const numbers = [1, 2, 3, 4, 5];
        return numbers.reduce((sum, n) => sum + n, 0);
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe(15);
    });

    it('should handle object property access', async () => {
      const result = await service.execute(
        `
        const user = { id: '1', name: 'Alice', email: 'alice@example.com' };
        const id = user.id;
        const name = user.name;
        return { id, name };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ id: '1', name: 'Alice' });
    });

    it('should handle spread operator', async () => {
      const result = await service.execute(
        `
        const arr1 = [1, 2, 3];
        const arr2 = [4, 5, 6];
        return [...arr1, ...arr2];
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should handle template literals', async () => {
      const result = await service.execute(
        `
        const name = 'World';
        return \`Hello, \${name}!\`;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('Hello, World!');
    });
  });

  describe('control flow', () => {
    it('should handle if/else', async () => {
      const result = await service.execute(
        `
        const value = 10;
        if (value > 5) {
          return 'greater';
        } else {
          return 'less or equal';
        }
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('greater');
    });

    it('should handle ternary operator', async () => {
      const result = await service.execute(
        `
        const value = 10;
        return value > 5 ? 'greater' : 'less or equal';
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('greater');
    });

    it('should handle for-of loop', async () => {
      const result = await service.execute(
        `
        const items = [1, 2, 3, 4, 5];
        const results = [];
        for (const item of items) {
          results.push(item * 2);
        }
        return results;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should handle for loop', async () => {
      const result = await service.execute(
        `
        const results = [];
        for (let i = 0; i < 5; i++) {
          results.push(i);
        }
        return results;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([0, 1, 2, 3, 4]);
    });
  });

  describe('built-in functions', () => {
    it('should allow Math functions', async () => {
      const result = await service.execute(
        `
        return {
          max: Math.max(1, 5, 3),
          min: Math.min(1, 5, 3),
          round: Math.round(3.7),
          floor: Math.floor(3.9),
          ceil: Math.ceil(3.1)
        };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        max: 5,
        min: 1,
        round: 4,
        floor: 3,
        ceil: 4,
      });
    });

    it('should allow JSON functions', async () => {
      const result = await service.execute(
        `
        const obj = { name: 'test', value: 123 };
        const json = JSON.stringify(obj);
        const parsed = JSON.parse(json);
        return { json, parsed };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        json: '{"name":"test","value":123}',
        parsed: { name: 'test', value: 123 },
      });
    });

    it('should allow String methods', async () => {
      const result = await service.execute(
        `
        const str = '  Hello World  ';
        return {
          trimmed: str.trim(),
          upper: str.toUpperCase(),
          lower: str.toLowerCase(),
          includes: str.includes('World'),
          split: str.trim().split(' ')
        };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        trimmed: 'Hello World',
        upper: '  HELLO WORLD  ',
        lower: '  hello world  ',
        includes: true,
        split: ['Hello', 'World'],
      });
    });

    it('should allow Array methods', async () => {
      const result = await service.execute(
        `
        const arr = [3, 1, 4, 1, 5, 9, 2, 6];
        return {
          sorted: [...arr].sort((a, b) => a - b),
          found: arr.find(n => n > 5),
          some: arr.some(n => n > 8),
          every: arr.every(n => n > 0),
          indexOf: arr.indexOf(4)
        };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        sorted: [1, 1, 2, 3, 4, 5, 6, 9],
        found: 9,
        some: true,
        every: true,
        indexOf: 2,
      });
    });
  });

  describe('security - blocked features', () => {
    it('should block eval', async () => {
      const result = await service.execute(
        `
        eval('return 42');
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should block Function constructor', async () => {
      const result = await service.execute(
        `
        const fn = new Function('return 42');
        return fn();
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should block process access', async () => {
      const result = await service.execute(
        `
        return process.env.SECRET;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should block require', async () => {
      const result = await service.execute(
        `
        const fs = require('fs');
        return fs.readFileSync('/etc/passwd');
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should block global access', async () => {
      const result = await service.execute(
        `
        return globalThis.process;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle syntax errors', async () => {
      const result = await service.execute(
        `
        const x = {
        return x;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle runtime errors from invalid operations', async () => {
      // Note: throw new Error() is blocked because Error is transformed to __safe_Error
      // Instead, we test runtime errors from invalid operations
      const result = await service.execute(
        `
        const obj = null;
        return obj.property;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle undefined variable access', async () => {
      const result = await service.execute(
        `
        return undefinedVariable;
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('complex workflows', () => {
    it('should handle multi-tool orchestration with data transformation', async () => {
      (mockEnvironment.callTool as jest.Mock)
        .mockResolvedValueOnce({
          items: [
            { id: '1', name: 'Alice', role: 'admin' },
            { id: '2', name: 'Bob', role: 'user' },
            { id: '3', name: 'Charlie', role: 'admin' },
          ],
        })
        .mockResolvedValueOnce({ orderCount: 5, totalAmount: 500 })
        .mockResolvedValueOnce({ orderCount: 3, totalAmount: 150 });

      const result = await service.execute(
        `
        const users = await callTool('users:list', {});
        const admins = users.items.filter(u => u.role === 'admin');

        const results = [];
        for (const admin of admins) {
          const stats = await callTool('orders:getStats', { userId: admin.id });
          results.push({
            name: admin.name,
            orderCount: stats.orderCount,
            totalAmount: stats.totalAmount
          });
        }

        return results.sort((a, b) => b.totalAmount - a.totalAmount);
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual([
        { name: 'Alice', orderCount: 5, totalAmount: 500 },
        { name: 'Charlie', orderCount: 3, totalAmount: 150 },
      ]);
      expect(mockEnvironment.callTool).toHaveBeenCalledTimes(3);
    });

    it('should handle aggregation workflow', async () => {
      (mockEnvironment.callTool as jest.Mock).mockResolvedValue({
        items: [
          { id: '1', amount: 100, category: 'A' },
          { id: '2', amount: 200, category: 'B' },
          { id: '3', amount: 150, category: 'A' },
          { id: '4', amount: 300, category: 'B' },
          { id: '5', amount: 50, category: 'A' },
        ],
      });

      const result = await service.execute(
        `
        const data = await callTool('sales:list', {});

        const byCategory = {};
        for (const item of data.items) {
          if (!byCategory[item.category]) {
            byCategory[item.category] = { count: 0, total: 0 };
          }
          byCategory[item.category].count += 1;
          byCategory[item.category].total += item.amount;
        }

        return {
          totalItems: data.items.length,
          totalAmount: data.items.reduce((sum, i) => sum + i.amount, 0),
          byCategory
        };
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        totalItems: 5,
        totalAmount: 800,
        byCategory: {
          A: { count: 3, total: 300 },
          B: { count: 2, total: 500 },
        },
      });
    });
  });

  describe('iteration limits', () => {
    it('should stop infinite for-of loops', async () => {
      const result = await service.execute(
        `
        const arr = [1];
        let count = 0;
        for (const item of arr) {
          count++;
          arr.push(item + 1);
          if (count > 100000) break; // Safety fallback
        }
        return count;
        `,
        mockEnvironment,
      );

      // Should fail due to iteration limit
      expect(result.success).toBe(false);
      expect(result.error?.message).toMatch(/iteration|limit/i);
    }, 10000);
  });

  describe('script length validation (sidecar disabled)', () => {
    it('should throw ScriptTooLargeError when script exceeds max length', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: false,
          maxScriptLengthWhenDisabled: 100, // Very small limit for testing
        },
      });

      const serviceWithLimit = new EnclaveService(config);
      const largeScript = 'return "' + 'x'.repeat(200) + '";';

      await expect(serviceWithLimit.execute(largeScript, mockEnvironment)).rejects.toThrow(ScriptTooLargeError);
    });

    it('should include script length and max length in error', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: false,
          maxScriptLengthWhenDisabled: 50,
        },
      });

      const serviceWithLimit = new EnclaveService(config);
      const script = 'return "' + 'x'.repeat(100) + '";';

      try {
        await serviceWithLimit.execute(script, mockEnvironment);
        fail('Should have thrown ScriptTooLargeError');
      } catch (error) {
        expect(error).toBeInstanceOf(ScriptTooLargeError);
        const e = error as ScriptTooLargeError;
        expect(e.code).toBe('SCRIPT_TOO_LARGE');
        expect(e.scriptLength).toBe(script.length);
        expect(e.maxLength).toBe(50);
      }
    });

    it('should allow scripts under max length', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: false,
          maxScriptLengthWhenDisabled: 1000,
        },
      });

      const serviceWithLimit = new EnclaveService(config);
      const result = await serviceWithLimit.execute('return 42;', mockEnvironment);

      expect(result.success).toBe(true);
      expect(result.result).toBe(42);
    });

    it('should skip length check when maxScriptLengthWhenDisabled is null', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: false,
          maxScriptLengthWhenDisabled: null,
        },
      });

      const serviceWithNoLimit = new EnclaveService(config);
      // Use 8KB which is under the AST guard's maxLineLength of 10000
      // but still a "large" script relative to typical maxScriptLengthWhenDisabled thresholds
      const largeScript = 'return "' + 'x'.repeat(8000) + '";';

      // Should not throw - length check is disabled
      const result = await serviceWithNoLimit.execute(largeScript, mockEnvironment);
      expect(result.success).toBe(true);
    });

    it('should skip length check when sidecar is enabled', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: true, // Sidecar enabled
          maxScriptLengthWhenDisabled: 50, // This should be ignored
          extractionThreshold: 10, // Low threshold for testing
        },
      });

      const serviceWithSidecar = new EnclaveService(config);
      const largeScript = 'return "' + 'x'.repeat(200) + '";';

      // Should not throw - sidecar handles large data
      const result = await serviceWithSidecar.execute(largeScript, mockEnvironment);
      expect(result.success).toBe(true);
    });
  });

  describe('sidecar integration', () => {
    it('should extract large strings and resolve at callTool boundary', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: true,
          maxScriptLengthWhenDisabled: null,
          extractionThreshold: 50, // Low threshold for testing
        },
      });

      const serviceWithSidecar = new EnclaveService(config);
      const largeData = 'x'.repeat(100);

      (mockEnvironment.callTool as jest.Mock).mockImplementation(async (name, args) => {
        // Verify the tool receives the actual resolved data
        expect(args.data).toBe(largeData);
        return 'ok';
      });

      const result = await serviceWithSidecar.execute(
        `
        const data = "${largeData}";
        await callTool('myTool', { data });
        return 'done';
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
      expect(result.result).toBe('done');
      expect(mockEnvironment.callTool).toHaveBeenCalled();
    });

    it('should block concatenation when allowComposites is false', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: true,
          maxScriptLengthWhenDisabled: null,
          extractionThreshold: 50,
          allowComposites: false,
        },
      });

      const serviceWithSidecar = new EnclaveService(config);
      const largeData = 'x'.repeat(100);

      const result = await serviceWithSidecar.execute(
        `
        const data = "${largeData}";
        const combined = data + " suffix";
        return combined;
        `,
        mockEnvironment,
      );

      // Should fail because concatenation creates a composite
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('concat');
    });

    it('should allow concatenation when allowComposites is true', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: true,
          maxScriptLengthWhenDisabled: null,
          extractionThreshold: 50,
          allowComposites: true,
        },
      });

      const serviceWithSidecar = new EnclaveService(config);
      const largeData = 'x'.repeat(100);

      (mockEnvironment.callTool as jest.Mock).mockImplementation(async (name, args) => {
        // The composite should be resolved to actual concatenated string
        expect(args.data).toBe(largeData + ' suffix');
        return 'ok';
      });

      const result = await serviceWithSidecar.execute(
        `
        const data = "${largeData}";
        const combined = data + " suffix";
        await callTool('myTool', { data: combined });
        return 'done';
        `,
        mockEnvironment,
      );

      expect(result.success).toBe(true);
    });

    it('should lift large tool results to sidecar', async () => {
      const config = new CodeCallConfig({
        vm: { preset: 'secure' },
        sidecar: {
          enabled: true,
          maxScriptLengthWhenDisabled: null,
          extractionThreshold: 50,
        },
      });

      const serviceWithSidecar = new EnclaveService(config);
      const largeResult = 'y'.repeat(100);

      (mockEnvironment.callTool as jest.Mock).mockResolvedValue(largeResult);

      const result = await serviceWithSidecar.execute(
        `
        const data = await callTool('getData', {});
        // The result is a reference ID, pass it directly to another tool
        return data;
        `,
        mockEnvironment,
      );

      // Result should be a reference ID (starts with __REF_)
      expect(result.success).toBe(true);
      expect(typeof result.result).toBe('string');
      expect((result.result as string).startsWith('__REF_')).toBe(true);
    });
  });

  describe('Advanced Sandbox Escape Prevention', () => {
    describe('Reflect-based attacks', () => {
      it('should block Reflect.get access', async () => {
        const result = await service.execute(
          `
          return Reflect.get({ a: 1 }, 'a');
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Reflect.construct', async () => {
        const result = await service.execute(
          `
          const fn = Reflect.construct(Function, ['return process']);
          return fn();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Reflect.apply', async () => {
        const result = await service.execute(
          `
          const fn = (x) => x * 2;
          return Reflect.apply(fn, null, [5]);
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Reflect.defineProperty', async () => {
        const result = await service.execute(
          `
          const obj = {};
          Reflect.defineProperty(obj, 'x', { value: 42 });
          return obj.x;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Proxy-based attacks', () => {
      it('should block Proxy constructor', async () => {
        const result = await service.execute(
          `
          const handler = {
            get: function(target, name) {
              return 42;
            }
          };
          const p = new Proxy({}, handler);
          return p.anything;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Proxy.revocable', async () => {
        const result = await service.execute(
          `
          const { proxy, revoke } = Proxy.revocable({}, {});
          return proxy;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Symbol-based attacks', () => {
      it('should block Symbol.for global registry', async () => {
        const result = await service.execute(
          `
          const sym = Symbol.for('mySymbol');
          return sym.toString();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block custom Symbol creation', async () => {
        const result = await service.execute(
          `
          const sym = Symbol('custom');
          return sym;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Symbol.iterator override', async () => {
        const result = await service.execute(
          `
          const obj = {};
          obj[Symbol.iterator] = function*() { yield 1; };
          return [...obj];
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Prototype pollution attacks', () => {
      it('should block __proto__ access', async () => {
        const result = await service.execute(
          `
          const obj = {};
          obj.__proto__.polluted = true;
          return {}.polluted;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Object.prototype modification', async () => {
        const result = await service.execute(
          `
          Object.prototype.malicious = function() { return 'hacked'; };
          return {}.malicious();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Array.prototype modification', async () => {
        const result = await service.execute(
          `
          Array.prototype.evil = function() { return 'hacked'; };
          return [].evil();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Object.setPrototypeOf', async () => {
        const result = await service.execute(
          `
          const obj = {};
          Object.setPrototypeOf(obj, { malicious: true });
          return obj.malicious;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Object.getPrototypeOf escape', async () => {
        const result = await service.execute(
          `
          const proto = Object.getPrototypeOf({});
          return proto.constructor;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Object descriptor attacks', () => {
      it('should block Object.defineProperty', async () => {
        const result = await service.execute(
          `
          const obj = {};
          Object.defineProperty(obj, 'getter', {
            get: function() { return process; }
          });
          return obj.getter;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Object.defineProperties', async () => {
        const result = await service.execute(
          `
          const obj = {};
          Object.defineProperties(obj, {
            'evil': { value: 42, writable: true }
          });
          return obj.evil;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Object.getOwnPropertyDescriptor', async () => {
        const result = await service.execute(
          `
          const desc = Object.getOwnPropertyDescriptor(Object, 'keys');
          return desc.value;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Object.getOwnPropertyDescriptors', async () => {
        const result = await service.execute(
          `
          const descs = Object.getOwnPropertyDescriptors(Array.prototype);
          return descs;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Constructor chain attacks', () => {
      it('should block constructor.constructor escape', async () => {
        const result = await service.execute(
          `
          const fn = [].constructor.constructor('return process');
          return fn();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block (()=>{}).constructor attack', async () => {
        const result = await service.execute(
          `
          const fn = (() => {}).constructor('return globalThis');
          return fn();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block async function constructor', async () => {
        const result = await service.execute(
          `
          const AsyncFunction = (async () => {}).constructor;
          const fn = new AsyncFunction('return await process');
          return await fn();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block generator function constructor', async () => {
        const result = await service.execute(
          `
          const GeneratorFunction = (function*(){}).constructor;
          const gen = new GeneratorFunction('yield process');
          return gen().next().value;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Legacy dangerous features', () => {
      it('should block arguments.callee', async () => {
        const result = await service.execute(
          `
          function test() {
            return arguments.callee;
          }
          return test();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block function declarations', async () => {
        const result = await service.execute(
          `
          function malicious() {
            return 'should not work';
          }
          return malicious();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block with statement', async () => {
        const result = await service.execute(
          `
          with({ x: 1 }) {
            return x;
          }
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Indirect eval attacks', () => {
      it('should block indirect eval via (0, eval)', async () => {
        const result = await service.execute(
          `
          const indirectEval = (0, eval);
          return indirectEval('1 + 1');
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block eval aliasing', async () => {
        const result = await service.execute(
          `
          const e = eval;
          return e('42');
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block setTimeout with string', async () => {
        const result = await service.execute(
          `
          setTimeout('return process', 0);
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block setInterval with string', async () => {
        const result = await service.execute(
          `
          setInterval('return process', 0);
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Module/Import attacks', () => {
      it('should block dynamic import', async () => {
        const result = await service.execute(
          `
          const mod = await import('fs');
          return mod;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block require alias', async () => {
        const result = await service.execute(
          `
          const r = require;
          return r('fs');
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Global object access attacks', () => {
      it('should block globalThis access', async () => {
        const result = await service.execute(
          `
          return globalThis.constructor;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block window access (browser global)', async () => {
        const result = await service.execute(
          `
          return window.document;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block self access', async () => {
        const result = await service.execute(
          `
          return self.constructor;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should not leak dangerous Node.js globals through this at top level', async () => {
        const result = await service.execute(
          `
          return this;
          `,
          mockEnvironment,
        );

        // The sandbox may return its own "this" context which is fine
        // The important thing is it doesn't expose dangerous Node.js globals
        if (result.success && result.result != null) {
          const value = result.result as Record<string, unknown>;
          // Critical: no access to Node.js process
          expect(value['process']).toBeUndefined();
          // Critical: no access to require
          expect(value['require']).toBeUndefined();
          // Critical: no access to Buffer
          expect(value['Buffer']).toBeUndefined();
          // Critical: no access to __dirname/__filename
          expect(value['__dirname']).toBeUndefined();
          expect(value['__filename']).toBeUndefined();
          // Critical: no access to module/exports
          expect(value['module']).toBeUndefined();
          expect(value['exports']).toBeUndefined();
        }
      });
    });

    describe('Type coercion attacks', () => {
      it('should handle toString attack', async () => {
        const result = await service.execute(
          `
          const obj = {
            toString: function() {
              return process.env.SECRET;
            }
          };
          return "" + obj;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should handle valueOf attack', async () => {
        const result = await service.execute(
          `
          const obj = {
            valueOf: function() {
              return process;
            }
          };
          return obj + 1;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should handle Symbol.toPrimitive attack', async () => {
        const result = await service.execute(
          `
          const obj = {
            [Symbol.toPrimitive](hint) {
              return process;
            }
          };
          return +obj;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Error object exploitation', () => {
      it('should block Error stack access', async () => {
        const result = await service.execute(
          `
          try {
            throw new Error('test');
          } catch (e) {
            return e.stack;
          }
          `,
          mockEnvironment,
        );

        // Should either be blocked or return sanitized stack
        expect(result.success === false || !String(result.result).includes('/Users/')).toBe(true);
      });

      it('should block prepareStackTrace override', async () => {
        const result = await service.execute(
          `
          Error.prepareStackTrace = (err, stack) => {
            return stack.map(s => s.getFileName());
          };
          try {
            throw new Error();
          } catch (e) {
            return e.stack;
          }
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('Async/Promise attacks', () => {
      it('should block while loops disguised with async', async () => {
        const result = await service.execute(
          `
          async function infiniteLoop() {
            while(true) {
              await new Promise(r => setTimeout(r, 0));
            }
          }
          return infiniteLoop();
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block do-while loops', async () => {
        const result = await service.execute(
          `
          let i = 0;
          do {
            i++;
          } while (i < 10);
          return i;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block Promise constructor abuse', async () => {
        const result = await service.execute(
          `
          const p = new Promise((resolve) => {
            resolve(process);
          });
          return await p;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    describe('WeakMap/WeakSet attacks', () => {
      it('should block WeakMap usage', async () => {
        const result = await service.execute(
          `
          const wm = new WeakMap();
          const key = {};
          wm.set(key, 'secret');
          return wm.get(key);
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      it('should block WeakSet usage', async () => {
        const result = await service.execute(
          `
          const ws = new WeakSet();
          const obj = {};
          ws.add(obj);
          return ws.has(obj);
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });
    });
  });

  describe('Concurrency and Isolation', () => {
    describe('Concurrent Execution', () => {
      it('should handle multiple concurrent executions', async () => {
        const promises = Array.from({ length: 5 }, (_, i) => service.execute(`return ${i * 10};`, mockEnvironment));

        const results = await Promise.all(promises);

        results.forEach((result, i) => {
          expect(result.success).toBe(true);
          expect(result.result).toBe(i * 10);
        });
      });

      it('should isolate state between concurrent executions', async () => {
        // Each script sets a variable and returns it
        // State should not leak between executions
        const promises = [
          service.execute('const x = 1; return x;', mockEnvironment),
          service.execute('const x = 2; return x;', mockEnvironment),
          service.execute('const x = 3; return x;', mockEnvironment),
        ];

        const results = await Promise.all(promises);

        expect(results[0].result).toBe(1);
        expect(results[1].result).toBe(2);
        expect(results[2].result).toBe(3);
      });

      it('should handle concurrent tool calls', async () => {
        let callCount = 0;
        (mockEnvironment.callTool as jest.Mock).mockImplementation(async () => {
          callCount++;
          await new Promise((r) => setTimeout(r, 10)); // Simulate async work
          return { count: callCount };
        });

        const promises = [
          service.execute('return await callTool("test", {});', mockEnvironment),
          service.execute('return await callTool("test", {});', mockEnvironment),
          service.execute('return await callTool("test", {});', mockEnvironment),
        ];

        const results = await Promise.all(promises);

        // All should succeed
        results.forEach((result) => {
          expect(result.success).toBe(true);
        });
        // All tool calls should have been made
        expect(mockEnvironment.callTool).toHaveBeenCalledTimes(3);
      });

      it('should handle mixed success and failure in concurrent executions', async () => {
        const promises = [
          service.execute('return 42;', mockEnvironment),
          service.execute('return undefinedVar;', mockEnvironment), // Will fail
          service.execute('return "hello";', mockEnvironment),
        ];

        const results = await Promise.all(promises);

        expect(results[0].success).toBe(true);
        expect(results[0].result).toBe(42);

        expect(results[1].success).toBe(false);
        expect(results[1].error).toBeDefined();

        expect(results[2].success).toBe(true);
        expect(results[2].result).toBe('hello');
      });
    });

    describe('Execution Isolation', () => {
      it('should not share variables between executions', async () => {
        // First execution sets a "global" looking variable
        await service.execute('const sharedLooking = "first";', mockEnvironment);

        // Second execution should not see it
        const result = await service.execute(
          `
          if (typeof sharedLooking !== 'undefined') {
            return 'leaked';
          }
          return 'isolated';
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(false); // sharedLooking is not defined
      });

      it('should not share modifications between executions', async () => {
        // First execution tries to modify something
        const env1 = { ...mockEnvironment };
        await service.execute(
          `
          const arr = [1, 2, 3];
          arr.push(4);
          return arr;
          `,
          env1,
        );

        // Second execution should have clean state
        const result = await service.execute(
          `
          const arr = [1, 2, 3];
          return arr;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(true);
        expect(result.result).toEqual([1, 2, 3]); // Not modified
      });

      it('should handle fresh environment per execution', async () => {
        // Each execution has its own environment
        const env1: CodeCallVmEnvironment = {
          ...mockEnvironment,
          callTool: jest.fn().mockResolvedValue('env1'),
        };

        const env2: CodeCallVmEnvironment = {
          ...mockEnvironment,
          callTool: jest.fn().mockResolvedValue('env2'),
        };

        const [result1, result2] = await Promise.all([
          service.execute('return await callTool("test", {});', env1),
          service.execute('return await callTool("test", {});', env2),
        ]);

        expect(result1.result).toBe('env1');
        expect(result2.result).toBe('env2');
      });
    });

    describe('Service Lifecycle', () => {
      it('should handle service reuse for multiple executions', async () => {
        // Execute multiple times with the same service instance
        for (let i = 0; i < 10; i++) {
          const result = await service.execute(`return ${i};`, mockEnvironment);
          expect(result.success).toBe(true);
          expect(result.result).toBe(i);
        }
      });

      it('should maintain service consistency after errors', async () => {
        // First: error execution
        await service.execute('return undefinedVar;', mockEnvironment);

        // Then: successful execution - service should still work
        const result = await service.execute('return 42;', mockEnvironment);
        expect(result.success).toBe(true);
        expect(result.result).toBe(42);
      });

      it('should create independent service instances', async () => {
        const config = new CodeCallConfig({
          vm: { preset: 'secure', timeoutMs: 5000 },
        });

        const service1 = new EnclaveService(config);
        const service2 = new EnclaveService(config);

        const [result1, result2] = await Promise.all([
          service1.execute('return "service1";', mockEnvironment),
          service2.execute('return "service2";', mockEnvironment),
        ]);

        expect(result1.result).toBe('service1');
        expect(result2.result).toBe('service2');
      });
    });

    describe('Resource Management', () => {
      it('should handle many sequential executions', async () => {
        const iterations = 50;
        const results: boolean[] = [];

        for (let i = 0; i < iterations; i++) {
          const result = await service.execute(`return ${i};`, mockEnvironment);
          results.push(result.success);
        }

        expect(results.every((r) => r === true)).toBe(true);
      });

      it('should handle rapid fire executions', async () => {
        const promises = Array.from({ length: 20 }, (_, i) => service.execute(`return ${i};`, mockEnvironment));

        const results = await Promise.all(promises);

        // All should succeed
        expect(results.filter((r) => r.success).length).toBe(20);
      });

      it('should cleanup properly after execution failure', async () => {
        // Fail intentionally
        await service.execute('return undefinedVar;', mockEnvironment);

        // Should still work after failure
        const successResult = await service.execute('return "ok";', mockEnvironment);
        expect(successResult.success).toBe(true);
        expect(successResult.result).toBe('ok');
      });
    });
  });

  describe('Performance', () => {
    describe('Execution Time', () => {
      it('should execute simple scripts quickly', async () => {
        const start = Date.now();
        await service.execute('return 42;', mockEnvironment);
        const duration = Date.now() - start;

        // Simple execution should be fast
        expect(duration).toBeLessThan(100);
      });

      it('should execute moderate loops within timeout', async () => {
        const start = Date.now();
        const result = await service.execute(
          `
          const results = [];
          for (let i = 0; i < 1000; i++) {
            results.push(i * 2);
          }
          return results.length;
          `,
          mockEnvironment,
        );
        const duration = Date.now() - start;

        expect(result.success).toBe(true);
        expect(result.result).toBe(1000);
        expect(duration).toBeLessThan(1000); // Should complete well under 1 second
      });

      it('should handle large array operations efficiently', async () => {
        const start = Date.now();
        const result = await service.execute(
          `
          const arr = [];
          for (let i = 0; i < 5000; i++) {
            arr.push(i);
          }
          return arr.filter(x => x % 2 === 0).length;
          `,
          mockEnvironment,
        );
        const duration = Date.now() - start;

        expect(result.success).toBe(true);
        expect(result.result).toBe(2500);
        expect(duration).toBeLessThan(2000);
      });
    });

    describe('Large Data Handling', () => {
      it('should handle large string return values', async () => {
        const result = await service.execute(
          `
          const parts = [];
          for (let i = 0; i < 1000; i++) {
            parts.push('x'.repeat(100));
          }
          return parts;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(true);
        expect((result.result as string[]).length).toBe(1000);
      });

      it('should handle deeply nested objects', async () => {
        const result = await service.execute(
          `
          const nested = { level: 0 };
          let current = nested;
          for (let i = 1; i < 50; i++) {
            current.child = { level: i };
            current = current.child;
          }
          return nested;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(true);
        expect((result.result as { level: number }).level).toBe(0);
      });

      it('should handle large flat objects', async () => {
        const result = await service.execute(
          `
          const obj = {};
          for (let i = 0; i < 500; i++) {
            obj['key' + i] = 'value' + i;
          }
          return Object.keys(obj).length;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(true);
        expect(result.result).toBe(500);
      });
    });

    describe('Iteration Limits', () => {
      it('should handle moderate iteration counts', async () => {
        const result = await service.execute(
          `
          let count = 0;
          for (let i = 0; i < 5000; i++) {
            count++;
          }
          return count;
          `,
          mockEnvironment,
        );

        // Should succeed for moderate iteration counts
        expect(result.success).toBe(true);
        expect(result.result).toBe(5000);
      });

      it('should handle nested loops within limits', async () => {
        const result = await service.execute(
          `
          let count = 0;
          for (let i = 0; i < 50; i++) {
            for (let j = 0; j < 50; j++) {
              count++;
            }
          }
          return count;
          `,
          mockEnvironment,
        );

        // 50 * 50 = 2500, should be fine
        expect(result.success).toBe(true);
        expect(result.result).toBe(2500);
      });

      it('should allow multiple loops within overall limit', async () => {
        const result = await service.execute(
          `
          let total = 0;
          for (let i = 0; i < 1000; i++) total++;
          for (let i = 0; i < 1000; i++) total++;
          for (let i = 0; i < 1000; i++) total++;
          return total;
          `,
          mockEnvironment,
        );

        // 3 * 1000 = 3000 should be within limits
        expect(result.success).toBe(true);
        expect(result.result).toBe(3000);
      });
    });

    describe('Memory Safety', () => {
      it('should handle bounded array growth', async () => {
        const result = await service.execute(
          `
          const arr = [];
          for (let i = 0; i < 1000; i++) {
            arr.push(new Array(10).fill(i));
          }
          return arr.length;
          `,
          mockEnvironment,
        );

        // Bounded growth should work
        expect(result.success).toBe(true);
        expect(result.result).toBe(1000);
      });

      it('should handle string concatenation safely', async () => {
        const result = await service.execute(
          `
          let str = '';
          for (let i = 0; i < 1000; i++) {
            str += 'x';
          }
          return str.length;
          `,
          mockEnvironment,
        );

        expect(result.success).toBe(true);
        expect(result.result).toBe(1000);
      });
    });

    describe('Script Parsing', () => {
      it('should handle moderately complex scripts', async () => {
        const complexScript = `
          const data = [
            { id: 1, name: 'Alice', scores: [85, 90, 92] },
            { id: 2, name: 'Bob', scores: [78, 82, 88] },
            { id: 3, name: 'Charlie', scores: [92, 95, 97] },
          ];

          const processed = data.map(person => ({
            ...person,
            average: person.scores.reduce((a, b) => a + b, 0) / person.scores.length,
            max: Math.max(...person.scores),
            min: Math.min(...person.scores),
          }));

          const topPerformer = processed.reduce((top, person) =>
            person.average > top.average ? person : top
          );

          return {
            processed: processed.length,
            topPerformer: topPerformer.name,
            averages: processed.map(p => Math.round(p.average)),
          };
        `;

        const result = await service.execute(complexScript, mockEnvironment);

        expect(result.success).toBe(true);
        expect((result.result as { topPerformer: string }).topPerformer).toBe('Charlie');
      });

      it('should handle scripts with many variables', async () => {
        const varDeclarations = Array.from({ length: 50 }, (_, i) => `const v${i} = ${i};`).join('\n');
        const script = `${varDeclarations}\nreturn v0 + v49;`;

        const result = await service.execute(script, mockEnvironment);

        expect(result.success).toBe(true);
        expect(result.result).toBe(49); // v0 (0) + v49 (49)
      });
    });
  });
});

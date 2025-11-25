// file: libs/plugins/src/codecall/__tests__/enclave.service.test.ts

import EnclaveService from '../services/enclave.service';
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
      codecallContext: Object.freeze({ userId: 'test-user', tenantId: 'test-tenant' }),
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
});

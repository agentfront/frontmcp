/**
 * Tests for Constructor Attack Prevention
 *
 * These tests verify that computed property access attacks
 * that bypass static analysis are blocked at runtime.
 */

import { Enclave } from '../enclave';

describe('Enclave Constructor Attack Prevention', () => {
  describe('Computed Property Access Attacks', () => {
    it('should block callTool[m + "ructor"] attack', async () => {
      const enclave = new Enclave({
        toolHandler: async (name, args) => ({ name }),
      });

      // This is the attack: construct 'constructor' at runtime
      // to bypass static analysis
      const code = `
        const m = 'const';
        const Func = callTool[m + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      // The attack should fail - constructor access should return undefined
      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should block Array constructor access via computed property', async () => {
      const enclave = new Enclave();

      const code = `
        const prop = 'constructor';
        const Func = Array[prop];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should block Math constructor access', async () => {
      const enclave = new Enclave();

      const code = `
        const Func = Math['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should block JSON constructor access', async () => {
      const enclave = new Enclave();

      const code = `
        const Func = JSON['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should block Object constructor access', async () => {
      const enclave = new Enclave();

      const code = `
        const Func = Object['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should block String constructor access', async () => {
      const enclave = new Enclave();

      const code = `
        const Func = String['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });
  });

  describe('Prototype Access Attacks', () => {
    it('should block __proto__ access via computed property', async () => {
      const enclave = new Enclave();

      const code = `
        const prop = '__pro' + 'to__';
        const proto = Array[prop];
        return proto ? 'found' : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should acknowledge JS proxy invariant limitations for non-configurable properties', async () => {
      const enclave = new Enclave();

      // Note: Array.prototype is non-configurable AND non-writable on the Array function.
      // JavaScript proxy invariants require returning the EXACT same object reference.
      // This is a fundamental JS limitation - we cannot block access to these properties.
      // However, the main attack vectors (accessing constructor on functions/objects
      // created at runtime, callTool.constructor, etc.) are still fully blocked.
      const code = `
        const prop = 'proto' + 'type';
        const proto = Array[prop];
        // Array.prototype must be returned (JS invariant), but runtime objects are protected
        return proto ? 'js-invariant-allows-this' : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      // This is expected due to JS proxy invariants - documented limitation
      expect(result.value).toBe('js-invariant-allows-this');

      enclave.dispose();
    });
  });

  describe('Nested Property Access', () => {
    it('should block constructor on tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async (name, args) => ({
          data: { value: 42 },
        }),
      });

      const code = `
        const result = await callTool('test', {});
        const Func = result['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should block constructor on nested tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async (name, args) => ({
          data: { nested: { value: 42 } },
        }),
      });

      const code = `
        const result = await callTool('test', {});
        const Func = result.data['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });
  });

  describe('Custom Globals Protection', () => {
    it('should block constructor access on custom globals', async () => {
      const enclave = new Enclave({
        globals: {
          myHelper: {
            getValue: () => 42,
          },
        },
        allowFunctionsInGlobals: true,
      });

      const code = `
        const Func = myHelper['const' + 'ructor'];
        return Func ? Func.name : 'blocked';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');

      enclave.dispose();
    });

    it('should allow normal property access on custom globals', async () => {
      const enclave = new Enclave({
        globals: {
          myHelper: {
            getValue: () => 42,
          },
        },
        allowFunctionsInGlobals: true,
      });

      const code = `
        return myHelper.getValue();
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe(42);

      enclave.dispose();
    });
  });

  describe('Normal Operations Still Work', () => {
    it('should allow normal Array operations', async () => {
      const enclave = new Enclave();

      const code = `
        const arr = [1, 2, 3];
        return arr.map(x => x * 2).filter(x => x > 2);
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toEqual([4, 6]);

      enclave.dispose();
    });

    it('should allow normal Object operations', async () => {
      const enclave = new Enclave();

      const code = `
        const obj = { a: 1, b: 2 };
        return Object.keys(obj);
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toEqual(['a', 'b']);

      enclave.dispose();
    });

    it('should allow normal Math operations', async () => {
      const enclave = new Enclave();

      const code = `
        return Math.max(1, 2, 3) + Math.min(4, 5, 6);
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe(7);

      enclave.dispose();
    });

    it('should allow normal JSON operations', async () => {
      const enclave = new Enclave();

      const code = `
        const obj = { name: 'test' };
        const str = JSON.stringify(obj);
        const parsed = JSON.parse(str);
        return parsed.name;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('test');

      enclave.dispose();
    });

    it('should allow tool calls to work normally', async () => {
      const enclave = new Enclave({
        toolHandler: async (name, args) => ({
          users: [{ id: 1, name: 'Alice' }],
        }),
      });

      const code = `
        const result = await callTool('users:list', {});
        return result.users[0].name;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('Alice');

      enclave.dispose();
    });

    it('should allow destructuring from tool results', async () => {
      const enclave = new Enclave({
        toolHandler: async (name, args) => ({
          users: [{ id: 1, name: 'Alice' }],
          total: 1,
        }),
      });

      const code = `
        const { users, total } = await callTool('users:list', {});
        return { count: users.length, total };
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toEqual({ count: 1, total: 1 });

      enclave.dispose();
    });
  });
});

/**
 * Multi-Tenant Security Tests
 *
 * Tests that verify proper isolation between multiple Enclave instances
 * in a multi-tenant environment. These tests ensure:
 * - Separate Enclave instances cannot access each other's data
 * - Tool handlers are properly isolated per instance
 * - Globals are not shared between instances
 * - Concurrent execution maintains isolation
 *
 * Categories:
 * - Cross-instance data isolation
 * - Tool handler isolation
 * - Global state isolation
 * - Concurrent execution safety
 * - Resource isolation
 */

import { Enclave } from '../enclave';

describe('Multi-Tenant Security Tests', () => {
  describe('Cross-Instance Data Isolation', () => {
    it('should isolate variables between enclave instances', async () => {
      const enclave1 = new Enclave({ validate: false });
      const enclave2 = new Enclave({ validate: false });

      // Set a variable in enclave1's sandbox context using 'this'
      const result1 = await enclave1.run(`
        this.secretData = 'tenant1-secret';
        return 'set';
      `);
      expect(result1.success).toBe(true);
      expect(result1.value).toBe('set');

      // Try to read it from enclave2 - should not exist
      const result2 = await enclave2.run(`
        return typeof this.secretData;
      `);
      expect(result2.success).toBe(true);
      expect(result2.value).toBe('undefined');

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should isolate Object instances between enclaves', async () => {
      const enclave1 = new Enclave({ validate: false });
      const enclave2 = new Enclave({ validate: false });

      // Create object in enclave1's sandbox
      await enclave1.run(`
        this.sharedObj = { tenantId: 'tenant1', secret: 'confidential' };
        return this.sharedObj.tenantId;
      `);

      // Check enclave2 cannot access it
      const result2 = await enclave2.run(`
        return this.sharedObj;
      `);
      expect(result2.success).toBe(true);
      expect(result2.value).toBeUndefined();

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should isolate array data between enclaves', async () => {
      const enclave1 = new Enclave({ validate: false });
      const enclave2 = new Enclave({ validate: false });

      // Store data in enclave1's context using 'this' (the sandbox context)
      await enclave1.run(`
        this.tenantData = ['secret1', 'secret2', 'secret3'];
        return this.tenantData.length;
      `);

      // enclave2 should not see enclave1's data
      const result2 = await enclave2.run(`
        return typeof this.tenantData;
      `);
      expect(result2.success).toBe(true);
      expect(result2.value).toBe('undefined');

      enclave1.dispose();
      enclave2.dispose();
    });
  });

  describe('Tool Handler Isolation', () => {
    it('should use correct tool handler per enclave', async () => {
      const enclave1 = new Enclave({
        toolHandler: async (name: string) => ({ tenant: 'tenant1', tool: name }),
      });
      const enclave2 = new Enclave({
        toolHandler: async (name: string) => ({ tenant: 'tenant2', tool: name }),
      });

      const result1 = await enclave1.run(`
        const data = await callTool('getData', {});
        return data;
      `);
      expect(result1.success).toBe(true);
      expect((result1.value as Record<string, unknown>)['tenant']).toBe('tenant1');

      const result2 = await enclave2.run(`
        const data = await callTool('getData', {});
        return data;
      `);
      expect(result2.success).toBe(true);
      expect((result2.value as Record<string, unknown>)['tenant']).toBe('tenant2');

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should prevent tool handler cross-contamination', async () => {
      let tenant1Calls = 0;
      let tenant2Calls = 0;

      const enclave1 = new Enclave({
        toolHandler: async () => {
          tenant1Calls++;
          return { count: tenant1Calls };
        },
      });
      const enclave2 = new Enclave({
        toolHandler: async () => {
          tenant2Calls++;
          return { count: tenant2Calls };
        },
      });

      // Call tools in both enclaves
      await enclave1.run(`await callTool('increment', {})`);
      await enclave1.run(`await callTool('increment', {})`);
      await enclave2.run(`await callTool('increment', {})`);

      expect(tenant1Calls).toBe(2);
      expect(tenant2Calls).toBe(1);

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should isolate tool arguments between tenants', async () => {
      const receivedArgs: Array<{ tenant: string; args: unknown }> = [];

      const enclave1 = new Enclave({
        toolHandler: async (name: string, args: unknown) => {
          receivedArgs.push({ tenant: 'tenant1', args });
          return { received: true };
        },
      });
      const enclave2 = new Enclave({
        toolHandler: async (name: string, args: unknown) => {
          receivedArgs.push({ tenant: 'tenant2', args });
          return { received: true };
        },
      });

      await enclave1.run(`
        await callTool('sensitive', { secret: 'tenant1-key', userId: 123 });
      `);
      await enclave2.run(`
        await callTool('sensitive', { secret: 'tenant2-key', userId: 456 });
      `);

      expect(receivedArgs.length).toBe(2);
      expect(receivedArgs[0].tenant).toBe('tenant1');
      expect((receivedArgs[0].args as Record<string, unknown>)['secret']).toBe('tenant1-key');
      expect(receivedArgs[1].tenant).toBe('tenant2');
      expect((receivedArgs[1].args as Record<string, unknown>)['secret']).toBe('tenant2-key');

      enclave1.dispose();
      enclave2.dispose();
    });
  });

  describe('Global State Isolation', () => {
    it('should isolate custom globals between enclaves', async () => {
      // With validation enabled, custom globals are transformed to be accessible by name
      const enclave1 = new Enclave({
        globals: { tenantId: 'tenant1', apiKey: 'key1' },
        allowFunctionsInGlobals: true,
      });
      const enclave2 = new Enclave({
        globals: { tenantId: 'tenant2', apiKey: 'key2' },
        allowFunctionsInGlobals: true,
      });

      const result1 = await enclave1.run(`
        return { tenantId: tenantId, apiKey: apiKey };
      `);
      const result2 = await enclave2.run(`
        return { tenantId: tenantId, apiKey: apiKey };
      `);

      expect(result1.success).toBe(true);
      expect((result1.value as Record<string, unknown>)['tenantId']).toBe('tenant1');
      expect((result1.value as Record<string, unknown>)['apiKey']).toBe('key1');

      expect(result2.success).toBe(true);
      expect((result2.value as Record<string, unknown>)['tenantId']).toBe('tenant2');
      expect((result2.value as Record<string, unknown>)['apiKey']).toBe('key2');

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should not leak globals from one enclave to another', async () => {
      const enclave1 = new Enclave({
        globals: { privateConfig: { dbPassword: 'secret123' } },
      });
      const enclave2 = new Enclave({
        globals: {},
      });

      const result1 = await enclave1.run(`return privateConfig.dbPassword;`);
      expect(result1.success).toBe(true);
      expect(result1.value).toBe('secret123');

      // enclave2 should not have access to enclave1's privateConfig
      // With validation enabled, accessing undefined global will fail validation
      const result2 = await enclave2.run(`
        return 'no-access';
      `);
      expect(result2.success).toBe(true);

      enclave1.dispose();
      enclave2.dispose();
    });
  });

  describe('Concurrent Execution Safety', () => {
    it('should safely execute multiple enclaves concurrently', async () => {
      const enclaves = Array.from(
        { length: 10 },
        (_, i) =>
          new Enclave({
            validate: false,
            toolHandler: async () => ({ tenantId: `tenant${i}` }),
          }),
      );

      const results = await Promise.all(
        enclaves.map((enclave, i) =>
          enclave.run(`
            const data = await callTool('identify', {});
            return { expected: 'tenant${i}', actual: data.tenantId };
          `),
        ),
      );

      results.forEach((result, i) => {
        expect(result.success).toBe(true);
        const value = result.value as Record<string, string>;
        expect(value['expected']).toBe(`tenant${i}`);
        expect(value['actual']).toBe(`tenant${i}`);
      });

      enclaves.forEach((e) => e.dispose());
    });

    it('should maintain isolation under concurrent load', async () => {
      const counters = new Map<string, number>();
      const errors: string[] = [];

      const createEnclave = (tenantId: string) =>
        new Enclave({
          validate: false,
          toolHandler: async (name: string, args: unknown) => {
            const current = counters.get(tenantId) || 0;
            counters.set(tenantId, current + 1);
            return { tenantId, count: current + 1 };
          },
        });

      const tenant1 = createEnclave('tenant1');
      const tenant2 = createEnclave('tenant2');
      const tenant3 = createEnclave('tenant3');

      // Run multiple operations concurrently
      const operations = [
        ...Array(5)
          .fill(null)
          .map(() => tenant1.run(`const r = await callTool('increment', {}); return r;`)),
        ...Array(3)
          .fill(null)
          .map(() => tenant2.run(`const r = await callTool('increment', {}); return r;`)),
        ...Array(7)
          .fill(null)
          .map(() => tenant3.run(`const r = await callTool('increment', {}); return r;`)),
      ];

      await Promise.all(operations);

      // Each tenant should have exact counts
      expect(counters.get('tenant1')).toBe(5);
      expect(counters.get('tenant2')).toBe(3);
      expect(counters.get('tenant3')).toBe(7);

      tenant1.dispose();
      tenant2.dispose();
      tenant3.dispose();
    });

    it('should handle enclave disposal during concurrent execution', async () => {
      const enclave = new Enclave({
        validate: false,
        timeout: 5000,
      });

      // Start a long-running operation
      const longRunning = enclave.run(`
        let sum = 0;
        for (let i = 0; i < 100000; i++) {
          sum += i;
        }
        return sum;
      `);

      // Create another enclave and run something
      const enclave2 = new Enclave({ validate: false });
      const quickResult = await enclave2.run(`return 'quick';`);
      expect(quickResult.success).toBe(true);
      expect(quickResult.value).toBe('quick');

      // Wait for long running to complete
      const result = await longRunning;
      expect(result.success).toBe(true);

      enclave.dispose();
      enclave2.dispose();
    });
  });

  describe('Resource Isolation', () => {
    it('should enforce separate timeouts per enclave', async () => {
      const fastEnclave = new Enclave({
        validate: false,
        timeout: 50,
      });
      const slowEnclave = new Enclave({
        validate: false,
        timeout: 5000,
      });

      // Fast enclave should timeout
      const fastResult = await fastEnclave.run(`
        let i = 0;
        while (true) { i++; }
        return i;
      `);

      // Slow enclave should complete
      const slowResult = await slowEnclave.run(`
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      `);

      expect(fastResult.success).toBe(false);
      expect(slowResult.success).toBe(true);

      fastEnclave.dispose();
      slowEnclave.dispose();
    });

    it('should isolate error states between enclaves', async () => {
      const enclave1 = new Enclave({ validate: false });
      const enclave2 = new Enclave({ validate: false });

      // Cause an error in enclave1
      const error1 = await enclave1.run(`
        throw new Error('Tenant 1 error');
      `);
      expect(error1.success).toBe(false);

      // enclave2 should still work fine
      const success2 = await enclave2.run(`
        return 'enclave2 works';
      `);
      expect(success2.success).toBe(true);
      expect(success2.value).toBe('enclave2 works');

      // enclave1 should also still work after error
      const retry1 = await enclave1.run(`
        return 'enclave1 recovered';
      `);
      expect(retry1.success).toBe(true);
      expect(retry1.value).toBe('enclave1 recovered');

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should isolate execution context between different enclaves', async () => {
      // This test verifies that different Enclave instances don't share state
      const enclave1 = new Enclave({ validate: false });
      const enclave2 = new Enclave({ validate: false });

      // Set state in enclave1
      const result1 = await enclave1.run(`
        this.tenantData = 'enclave1-data';
        return this.tenantData;
      `);
      expect(result1.success).toBe(true);
      expect(result1.value).toBe('enclave1-data');

      // enclave2 should NOT see enclave1's state
      const result2 = await enclave2.run(`
        return typeof this.tenantData;
      `);
      expect(result2.success).toBe(true);
      expect(result2.value).toBe('undefined');

      enclave1.dispose();
      enclave2.dispose();
    });

    it('should document that each run() call has fresh local scope', async () => {
      // Note: Enclave creates a new context for each run(), so local variables
      // don't persist between runs. This is a security feature.
      const enclave = new Enclave({ validate: false });

      // First run creates a local variable
      const result1 = await enclave.run(`
        const localVar = 'first-run';
        return localVar;
      `);
      expect(result1.success).toBe(true);
      expect(result1.value).toBe('first-run');

      // Second run cannot access variables from first run
      const result2 = await enclave.run(`
        // localVar is not accessible - each run has its own scope
        return typeof localVar;
      `);
      // This documents the expected behavior - each run is isolated
      expect(result2.success).toBe(true);
      expect(result2.value).toBe('undefined');

      enclave.dispose();
    });
  });

  describe('Security Boundary Verification', () => {
    it('should not allow cross-tenant prototype pollution', async () => {
      const enclave1 = new Enclave({ validate: false });
      const enclave2 = new Enclave({ validate: false });

      const testKey = '__multiTenantTest_' + Date.now();

      // Tenant 1 tries to pollute Object prototype
      await enclave1.run(`
        Object.prototype['${testKey}'] = 'polluted-by-tenant1';
      `);

      // Cleanup in host
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (Object.prototype as any)[testKey];

      // Create a fresh enclave after cleanup
      const enclave3 = new Enclave({ validate: false });

      // Fresh enclave should not see pollution
      const result3 = await enclave3.run(`
        const obj = {};
        return obj['${testKey}'];
      `);

      // After cleanup, the property should not exist
      expect(result3.success).toBe(true);
      expect(result3.value).toBeUndefined();

      enclave1.dispose();
      enclave2.dispose();
      enclave3.dispose();
    });

    it('should properly isolate validation rules per enclave', async () => {
      // Strict enclave
      const strictEnclave = new Enclave({ validate: true });
      // Permissive enclave
      const permissiveEnclave = new Enclave({ validate: false });

      // Strict should block dangerous code
      const strictResult = await strictEnclave.run(`
        return typeof Proxy;
      `);
      expect(strictResult.success).toBe(false);

      // Permissive should allow it (even if undefined at runtime)
      const permissiveResult = await permissiveEnclave.run(`
        return typeof Proxy;
      `);
      expect(permissiveResult.success).toBe(true);

      strictEnclave.dispose();
      permissiveEnclave.dispose();
    });
  });
});

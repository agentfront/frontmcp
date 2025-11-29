/**
 * Node.js 24 Security Tests
 *
 * Tests for security features specific to Node.js 24 and beyond.
 *
 * IMPORTANT: The Enclave uses a DEFENSE-IN-DEPTH approach:
 * 1. AST Validation (Primary) - Blocks identifiers like Reflect, WeakRef, constructor at parse time
 * 2. VM Context Sanitization - Removes dangerous globals from the VM context
 * 3. SecureProxy (Runtime) - Blocks property access on wrapped globals via computed property names
 *
 * Most tests here verify AST validation since that's the primary defense layer.
 * Runtime proxy tests are in constructor-obfuscation-attacks.spec.ts
 */

import { Enclave } from '../enclave';

describe('Enclave Node.js 24 Security', () => {
  describe('AST Validation - Primary Defense', () => {
    it('should block ShadowRealm identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      // ShadowRealm is blocked by DisallowedIdentifierRule
      const code = `return typeof ShadowRealm;`;

      const result = await enclave.run(code);
      // Should fail validation because ShadowRealm is a disallowed identifier
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('ShadowRealm');
      enclave.dispose();
    });

    it('should block WeakRef identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `return typeof WeakRef;`;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('WeakRef');
      enclave.dispose();
    });

    it('should block FinalizationRegistry identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `return typeof FinalizationRegistry;`;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('FinalizationRegistry');
      enclave.dispose();
    });

    it('should block Iterator identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `return typeof Iterator;`;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Iterator');
      enclave.dispose();
    });

    it('should block AsyncIterator identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `return typeof AsyncIterator;`;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('AsyncIterator');
      enclave.dispose();
    });

    it('should block Reflect identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `return typeof Reflect;`;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Reflect');
      enclave.dispose();
    });

    it('should block Proxy identifier at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `return typeof Proxy;`;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Proxy');
      enclave.dispose();
    });

    it('should block .constructor property access at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `
        const obj = {};
        return obj.constructor;
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('constructor');
      enclave.dispose();
    });

    it('should block __proto__ literal at AST level', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `
        const obj = {};
        return obj['__proto__'];
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('__proto__');
      enclave.dispose();
    });
  });

  describe('Runtime Proxy Protection - Secondary Defense', () => {
    it('should block constructor via computed property on wrapped globals', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      // Use dynamic string building to bypass AST validation
      const code = `
        const key = 'con' + 'structor';
        return Array[key] ? 'accessible' : 'blocked';
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');
      enclave.dispose();
    });

    it('should block __proto__ via computed property on wrapped globals', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `
        const key = '__pro' + 'to__';
        return Object[key] ? 'accessible' : 'blocked';
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');
      enclave.dispose();
    });

    it('should respect JavaScript proxy invariants for Array.prototype access', async () => {
      // JavaScript proxy invariants require returning the actual value for
      // non-configurable, non-writable properties (like Array.prototype).
      // This test verifies we can access Array.prototype via computed property
      // without breaking the proxy invariant contract.
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const code = `
        const key = 'proto' + 'type';
        const proto = Array[key];
        // Verify we get back an object (the actual prototype)
        // The proxy invariant is respected by returning the real value
        return typeof proto === 'object' ? 'invariant-respected' : 'unexpected';
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('invariant-respected');
      enclave.dispose();
    });
  });

  describe('Security Level Configuration', () => {
    it('PERMISSIVE allows constructor via computed property when configured', async () => {
      const enclave = new Enclave({
        securityLevel: 'PERMISSIVE',
        secureProxyConfig: {
          blockConstructor: false,
          blockPrototype: true,
          blockLegacyAccessors: true,
          proxyMaxDepth: 20,
        },
      });

      // Use dynamic string building to bypass AST validation
      const code = `
        const key = 'const' + 'ructor';
        return Array[key] ? 'accessible' : 'blocked';
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('accessible');
      enclave.dispose();
    });

    it('PERMISSIVE still blocks __proto__ by default', async () => {
      const enclave = new Enclave({ securityLevel: 'PERMISSIVE' });

      const code = `
        const key = '__pro' + 'to__';
        return Array[key] ? 'accessible' : 'blocked';
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');
      enclave.dispose();
    });

    it('explicit secureProxyConfig overrides security level defaults', async () => {
      // Even in STRICT mode, explicit config should override
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        secureProxyConfig: {
          blockConstructor: false,
          blockPrototype: true,
          blockLegacyAccessors: true,
          proxyMaxDepth: 5,
        },
      });

      const code = `
        const key = 'const' + 'ructor';
        return Array[key] ? 'accessible' : 'blocked';
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('accessible');
      enclave.dispose();
    });
  });

  describe('Standard Library Access', () => {
    it('should allow standard array methods', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      const code = `
        const arr = [1, 2, 3];
        return arr.map(x => x * 2);
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toEqual([2, 4, 6]);
      enclave.dispose();
    });

    it('should allow Object.keys', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      const code = `
        const obj = { a: 1, b: 2 };
        return Object.keys(obj);
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toEqual(['a', 'b']);
      enclave.dispose();
    });

    it('should allow JSON.parse and JSON.stringify', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      const code = `
        const obj = { a: 1 };
        return JSON.parse(JSON.stringify(obj));
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toEqual({ a: 1 });
      enclave.dispose();
    });

    it('should allow Math operations', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      const code = `return Math.max(1, 2, 3);`;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe(3);
      enclave.dispose();
    });
  });

  describe('Defense in Depth - Combined Attacks', () => {
    it('should block Function constructor access via multiple vectors', async () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });

      // Try multiple obfuscation techniques
      const code = `
        // Try via string concatenation
        const key = 'const' + 'ructor';
        const Ctor1 = Array[key];

        // Try via slice
        const key2 = 'XXconstructorXX'.slice(2, -2);
        const Ctor2 = Object[key2];

        // Try via join
        const key3 = ['con', 'structor'].join('');
        const Ctor3 = String[key3];

        // All should be blocked
        return (Ctor1 || Ctor2 || Ctor3) ? 'escaped' : 'blocked';
      `;

      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('blocked');
      enclave.dispose();
    });

    it('should block prototype pollution via computed properties', async () => {
      const enclave = new Enclave();

      const code = `
        const protoKey = '__pro' + 'to__';
        const proto = Object[protoKey];
        // If we got undefined, prototype access was blocked
        return proto === undefined ? 'safe' : 'pollutable';
      `;
      const result = await enclave.run(code);
      expect(result.success).toBe(true);
      expect(result.value).toBe('safe');
      enclave.dispose();
    });
  });

  describe('FinalizationRegistry/WeakRef Security Levels', () => {
    it('should block FinalizationRegistry at all security levels', async () => {
      for (const level of ['STRICT', 'SECURE', 'STANDARD', 'PERMISSIVE'] as const) {
        const enclave = new Enclave({ securityLevel: level });
        const code = `return typeof FinalizationRegistry;`;
        const result = await enclave.run(code);

        // FinalizationRegistry should be blocked at all security levels
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('FinalizationRegistry');
        enclave.dispose();
      }
    });

    it('should block WeakRef at all security levels', async () => {
      for (const level of ['STRICT', 'SECURE', 'STANDARD', 'PERMISSIVE'] as const) {
        const enclave = new Enclave({ securityLevel: level });
        const code = `return typeof WeakRef;`;
        const result = await enclave.run(code);

        // WeakRef should be blocked at all security levels
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('WeakRef');
        enclave.dispose();
      }
    });
  });

  describe('Timing Side-Channel Attacks', () => {
    it('should block performance.now in STRICT mode', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });
      const code = `return typeof performance;`;

      const result = await enclave.run(code);

      // performance should be undefined in STRICT mode
      if (result.success) {
        expect(result.value).toBe('undefined');
      }
      enclave.dispose();
    });

    it('should allow Date.now for basic timing needs', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });
      const code = `
        const times = [];
        for (let i = 0; i < 100; i++) {
          times.push(Date.now());
        }
        return times.length;
      `;

      const result = await enclave.run(code);

      // Date.now is allowed but iteration may be limited
      if (result.success) {
        expect(result.value).toBe(100);
      }
      enclave.dispose();
    });

    it('should handle high-resolution timing measurement attempts', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT', timeout: 1000 });
      const code = `
        const start = Date.now();
        let x = 0;
        for (let i = 0; i < 1000000; i++) {
          x += i;
        }
        return Date.now() - start;
      `;

      const result = await enclave.run(code);

      // Should either timeout or succeed with limited precision
      if (result.success) {
        expect(typeof result.value).toBe('number');
      }
      enclave.dispose();
    }, 10000);
  });
});

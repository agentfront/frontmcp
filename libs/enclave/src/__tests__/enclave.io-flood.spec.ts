/**
 * Enclave I/O Flood Protection Tests
 *
 * Tests defense against I/O flood attacks via excessive console output.
 * These attacks attempt to exhaust resources by spamming console.log/warn/error/info.
 *
 * Attack Vector: I/O Logging Flood (from security audit)
 * - Attacker floods console output to exhaust memory/disk
 * - Attacker makes excessive console calls to slow down execution
 * - Defense: Rate limiting on both output size and call count
 */

import { Enclave } from '../enclave';

describe('I/O Flood Protection', () => {
  describe('Console Output Size Limiting', () => {
    it('should limit total console output bytes', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleOutputBytes: 1024, // 1KB limit for test
      });

      // Try to output more than the limit
      const code = `
        const bigString = 'x'.repeat(2000);
        console.log(bigString);
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console output size limit exceeded');
      expect(result.error?.message).toContain('I/O flood attacks');

      enclave.dispose();
    });

    it('should track output across multiple console calls', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleOutputBytes: 500, // 500 bytes limit
      });

      // Multiple small outputs that exceed total limit
      const code = `
        for (let i = 0; i < 10; i++) {
          console.log('x'.repeat(100)); // 100 bytes each, 1000 total
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console output size limit exceeded');

      enclave.dispose();
    });

    it('should track output across all console methods', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleOutputBytes: 300, // 300 bytes limit
      });

      // Mix of console methods
      const code = `
        console.log('x'.repeat(100));
        console.warn('y'.repeat(100));
        console.error('z'.repeat(100));
        console.info('w'.repeat(100)); // This should exceed limit
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console output size limit exceeded');

      enclave.dispose();
    });

    it('should allow output within limits', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleOutputBytes: 1024, // 1KB limit
      });

      const code = `
        console.log('Hello, world!');
        console.warn('This is a warning');
        return 'success';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');

      enclave.dispose();
    });
  });

  describe('Console Call Count Limiting', () => {
    it('should limit console call count', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleCalls: 5, // Only 5 calls allowed
      });

      const code = `
        for (let i = 0; i < 10; i++) {
          console.log(i);
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console call limit exceeded');
      expect(result.error?.message).toContain('I/O flood attacks');

      enclave.dispose();
    });

    it('should count all console methods toward limit', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleCalls: 4, // Only 4 calls allowed
      });

      const code = `
        console.log('1');
        console.warn('2');
        console.error('3');
        console.info('4');
        console.log('5'); // This exceeds the limit
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console call limit exceeded');

      enclave.dispose();
    });

    it('should allow calls within limit', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleCalls: 10,
      });

      const code = `
        for (let i = 0; i < 5; i++) {
          console.log(i);
        }
        return 'success';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');

      enclave.dispose();
    });
  });

  describe('Security Level Presets', () => {
    it('should use STRICT preset limits (64KB, 100 calls)', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });
      const config = enclave.getEffectiveConfig();

      // STRICT has tightest limits
      expect(config.securityLevel).toBe('STRICT');
      // We can't access maxConsoleOutputBytes directly, but we can test behavior

      enclave.dispose();
    });

    it('should enforce STRICT limits on large output', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      // STRICT limit is 64KB, try to exceed it
      const code = `
        const bigString = 'x'.repeat(100000); // 100KB
        console.log(bigString);
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console output size limit exceeded');

      enclave.dispose();
    });

    it('should enforce STRICT call limit', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      // STRICT limit is 100 calls, try to exceed it
      const code = `
        for (let i = 0; i < 150; i++) {
          console.log(i);
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console call limit exceeded');

      enclave.dispose();
    });

    it('should use PERMISSIVE preset with higher limits', async () => {
      const enclave = new Enclave({ securityLevel: 'PERMISSIVE' });

      // PERMISSIVE allows 10MB and 10000 calls
      // This should succeed under PERMISSIVE but would fail under STRICT
      const code = `
        for (let i = 0; i < 500; i++) {
          console.log('message ' + i);
        }
        return 'success';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');

      enclave.dispose();
    });
  });

  describe('Object Serialization in Console', () => {
    it('should handle object serialization in output size calculation', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleOutputBytes: 100,
      });

      // Large object that serializes to more than limit
      const code = `
        const bigObject = { data: 'x'.repeat(200) };
        console.log(bigObject);
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console output size limit exceeded');

      enclave.dispose();
    });

    it('should handle circular references gracefully', async () => {
      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        maxConsoleOutputBytes: 1024,
      });

      // Circular reference should fall back to String()
      const code = `
        const obj = { name: 'test' };
        obj.self = obj; // circular reference
        console.log(obj);
        return 'success';
      `;

      const result = await enclave.run(code);

      // Should not crash, either succeeds or fails with size limit
      expect(result.error?.message || '').not.toContain('circular');

      enclave.dispose();
    });

    it('should handle null and undefined values', async () => {
      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        maxConsoleOutputBytes: 1024,
      });

      const code = `
        console.log(null);
        console.log(undefined);
        console.log(null, undefined, 'test');
        return 'success';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');

      enclave.dispose();
    });
  });

  describe('Attack Scenarios', () => {
    it('should prevent excessive console.log in loop attack', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleCalls: 100,
        maxIterations: 1000,
      });

      // Attack: for loop with excessive console.log calls
      // Note: while(true) is blocked by AgentScript validation, so we use for
      const code = `
        for (let i = 0; i < 10000; i++) {
          console.log('spam');
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      // Should hit either console limit or iteration limit
      const errorMessage = result.error?.message || '';
      expect(
        errorMessage.includes('Console call limit exceeded') ||
          errorMessage.includes('iteration limit') ||
          errorMessage.includes('Iteration limit exceeded'),
      ).toBe(true);

      enclave.dispose();
    });

    it('should prevent exponential output growth attack', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleOutputBytes: 10000, // 10KB
      });

      // Attack: exponential string growth
      const code = `
        let str = 'x';
        for (let i = 0; i < 20; i++) {
          str = str + str; // doubles each iteration
          console.log(str);
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console output size limit exceeded');

      enclave.dispose();
    });

    it('should prevent rapid-fire small message attack', async () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        maxConsoleCalls: 100,
      });

      // Attack: many small messages
      const code = `
        for (let i = 0; i < 1000; i++) {
          console.log('.');
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('Console call limit exceeded');

      enclave.dispose();
    });
  });
});

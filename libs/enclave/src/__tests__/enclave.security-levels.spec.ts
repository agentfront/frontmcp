/**
 * Security Level Configuration Tests
 *
 * Tests for the security level system that provides pre-configured
 * security profiles for different use cases.
 */

import { Enclave, SECURITY_LEVEL_CONFIGS } from '../index';
import type { SecurityLevel, ToolHandler } from '../types';

describe('Security Level Configuration', () => {
  describe('Security Level Presets', () => {
    it('should have all four security levels defined', () => {
      expect(SECURITY_LEVEL_CONFIGS).toHaveProperty('STRICT');
      expect(SECURITY_LEVEL_CONFIGS).toHaveProperty('SECURE');
      expect(SECURITY_LEVEL_CONFIGS).toHaveProperty('STANDARD');
      expect(SECURITY_LEVEL_CONFIGS).toHaveProperty('PERMISSIVE');
    });

    it('should have STRICT as the most restrictive', () => {
      const strict = SECURITY_LEVEL_CONFIGS.STRICT;
      const standard = SECURITY_LEVEL_CONFIGS.STANDARD;

      expect(strict.timeout).toBeLessThan(standard.timeout);
      expect(strict.maxIterations).toBeLessThan(standard.maxIterations);
      expect(strict.maxToolCalls).toBeLessThan(standard.maxToolCalls);
      expect(strict.sanitizeStackTraces).toBe(true);
      expect(strict.allowFunctionsInGlobals).toBe(false);
    });

    it('should have PERMISSIVE as the least restrictive', () => {
      const permissive = SECURITY_LEVEL_CONFIGS.PERMISSIVE;
      const standard = SECURITY_LEVEL_CONFIGS.STANDARD;

      expect(permissive.timeout).toBeGreaterThan(standard.timeout);
      expect(permissive.maxIterations).toBeGreaterThan(standard.maxIterations);
      expect(permissive.maxToolCalls).toBeGreaterThan(standard.maxToolCalls);
      expect(permissive.allowFunctionsInGlobals).toBe(true);
    });

    it('should have proper hierarchy: STRICT < SECURE < STANDARD < PERMISSIVE', () => {
      const levels: SecurityLevel[] = ['STRICT', 'SECURE', 'STANDARD', 'PERMISSIVE'];
      const configs = levels.map((l) => SECURITY_LEVEL_CONFIGS[l]);

      // Each level should have more permissive settings than the previous
      for (let i = 1; i < configs.length; i++) {
        expect(configs[i].timeout).toBeGreaterThanOrEqual(configs[i - 1].timeout);
        expect(configs[i].maxIterations).toBeGreaterThanOrEqual(configs[i - 1].maxIterations);
        expect(configs[i].maxToolCalls).toBeGreaterThanOrEqual(configs[i - 1].maxToolCalls);
      }
    });
  });

  describe('Enclave Security Level Application', () => {
    it('should default to STANDARD security level', () => {
      const enclave = new Enclave();
      expect(enclave.getSecurityLevel()).toBe('STANDARD');
      enclave.dispose();
    });

    it('should apply STRICT security level configuration', () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });
      const config = enclave.getEffectiveConfig();

      expect(enclave.getSecurityLevel()).toBe('STRICT');
      expect(config.timeout).toBe(SECURITY_LEVEL_CONFIGS.STRICT.timeout);
      expect(config.maxIterations).toBe(SECURITY_LEVEL_CONFIGS.STRICT.maxIterations);
      expect(config.maxToolCalls).toBe(SECURITY_LEVEL_CONFIGS.STRICT.maxToolCalls);
      expect(config.sanitizeStackTraces).toBe(true);

      enclave.dispose();
    });

    it('should apply SECURE security level configuration', () => {
      const enclave = new Enclave({ securityLevel: 'SECURE' });
      const config = enclave.getEffectiveConfig();

      expect(enclave.getSecurityLevel()).toBe('SECURE');
      expect(config.timeout).toBe(SECURITY_LEVEL_CONFIGS.SECURE.timeout);
      expect(config.maxIterations).toBe(SECURITY_LEVEL_CONFIGS.SECURE.maxIterations);

      enclave.dispose();
    });

    it('should apply STANDARD security level configuration', () => {
      const enclave = new Enclave({ securityLevel: 'STANDARD' });
      const config = enclave.getEffectiveConfig();

      expect(enclave.getSecurityLevel()).toBe('STANDARD');
      expect(config.timeout).toBe(SECURITY_LEVEL_CONFIGS.STANDARD.timeout);
      expect(config.sanitizeStackTraces).toBe(false);

      enclave.dispose();
    });

    it('should apply PERMISSIVE security level configuration', () => {
      const enclave = new Enclave({ securityLevel: 'PERMISSIVE' });
      const config = enclave.getEffectiveConfig();

      expect(enclave.getSecurityLevel()).toBe('PERMISSIVE');
      expect(config.timeout).toBe(SECURITY_LEVEL_CONFIGS.PERMISSIVE.timeout);
      expect(config.maxIterations).toBe(SECURITY_LEVEL_CONFIGS.PERMISSIVE.maxIterations);

      enclave.dispose();
    });
  });

  describe('Explicit Option Overrides', () => {
    it('should allow overriding timeout from security level', () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        timeout: 20000, // Override STRICT's 5000ms
      });
      const config = enclave.getEffectiveConfig();

      expect(config.securityLevel).toBe('STRICT');
      expect(config.timeout).toBe(20000);
      // Other STRICT settings should remain
      expect(config.maxToolCalls).toBe(SECURITY_LEVEL_CONFIGS.STRICT.maxToolCalls);

      enclave.dispose();
    });

    it('should allow overriding maxIterations from security level', () => {
      const enclave = new Enclave({
        securityLevel: 'SECURE',
        maxIterations: 2000,
      });
      const config = enclave.getEffectiveConfig();

      expect(config.maxIterations).toBe(2000);
      expect(config.timeout).toBe(SECURITY_LEVEL_CONFIGS.SECURE.timeout);

      enclave.dispose();
    });

    it('should allow overriding maxToolCalls from security level', () => {
      const enclave = new Enclave({
        securityLevel: 'STANDARD',
        maxToolCalls: 25,
      });
      const config = enclave.getEffectiveConfig();

      expect(config.maxToolCalls).toBe(25);

      enclave.dispose();
    });

    it('should allow overriding sanitizeStackTraces', () => {
      const enclave = new Enclave({
        securityLevel: 'STANDARD', // Default: false
        sanitizeStackTraces: true, // Override to true
      });
      const config = enclave.getEffectiveConfig();

      expect(config.sanitizeStackTraces).toBe(true);

      enclave.dispose();
    });

    it('should allow multiple overrides simultaneously', () => {
      const enclave = new Enclave({
        securityLevel: 'STRICT',
        timeout: 15000,
        maxIterations: 3000,
        maxToolCalls: 30,
      });
      const config = enclave.getEffectiveConfig();

      expect(config.securityLevel).toBe('STRICT');
      expect(config.timeout).toBe(15000);
      expect(config.maxIterations).toBe(3000);
      expect(config.maxToolCalls).toBe(30);
      // Sanitization settings should still be from STRICT
      expect(config.sanitizeStackTraces).toBe(true);

      enclave.dispose();
    });
  });

  describe('Security Level Behavior', () => {
    it('STRICT should enforce low iteration limit', async () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });

      // STRICT has maxIterations: 1000
      // Use for-of loop which is transformed to __safe_forOf
      const code = `
        const items = Array.from({ length: 2000 }, (_, i) => i);
        let count = 0;
        for (const item of items) {
          count++;
        }
        return count;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('iteration');

      enclave.dispose();
    });

    it('STRICT should enforce low tool call limit', async () => {
      const toolHandler: ToolHandler = async () => ({ ok: true });

      const enclave = new Enclave({
        securityLevel: 'STRICT',
        toolHandler,
      });

      // STRICT has maxToolCalls: 10
      const code = `
        for (let i = 0; i < 15; i++) {
          await callTool('test', {});
        }
        return 'done';
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain('tool call');

      enclave.dispose();
    });

    it('PERMISSIVE should allow more iterations', async () => {
      const enclave = new Enclave({ securityLevel: 'PERMISSIVE' });

      // This would fail in STRICT (1000) but pass in PERMISSIVE (100000)
      // Use for-of loop which is transformed to __safe_forOf
      const code = `
        const items = Array.from({ length: 5000 }, (_, i) => i);
        let count = 0;
        for (const item of items) {
          count++;
        }
        return count;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(true);
      expect(result.value).toBe(5000);

      enclave.dispose();
    });

    it('PERMISSIVE should allow functions in globals', () => {
      // This should NOT throw with PERMISSIVE
      expect(() => {
        const enclave = new Enclave({
          securityLevel: 'PERMISSIVE',
          globals: {
            helper: () => 42,
          },
        });
        enclave.dispose();
      }).not.toThrow();
    });

    it('STRICT should block functions in globals', () => {
      // This should throw with STRICT
      expect(() => {
        new Enclave({
          securityLevel: 'STRICT',
          globals: {
            helper: () => 42,
          },
        });
      }).toThrow(/function/i);
    });
  });

  describe('getEffectiveConfig', () => {
    it('should return all configuration values', () => {
      const enclave = new Enclave({ securityLevel: 'SECURE' });
      const config = enclave.getEffectiveConfig();

      expect(config).toHaveProperty('securityLevel');
      expect(config).toHaveProperty('timeout');
      expect(config).toHaveProperty('maxIterations');
      expect(config).toHaveProperty('maxToolCalls');
      expect(config).toHaveProperty('sanitizeStackTraces');
      expect(config).toHaveProperty('maxSanitizeDepth');
      expect(config).toHaveProperty('maxSanitizeProperties');
      expect(config).toHaveProperty('memoryLimit');

      enclave.dispose();
    });

    it('should return immutable-like copy', () => {
      const enclave = new Enclave({ securityLevel: 'STRICT' });
      const config1 = enclave.getEffectiveConfig();
      const config2 = enclave.getEffectiveConfig();

      // Should be equal but not same reference
      expect(config1).toEqual(config2);
      expect(config1).not.toBe(config2);

      enclave.dispose();
    });
  });

  describe('runAgentScript with Security Levels', () => {
    it('should accept security level in runAgentScript', async () => {
      const { runAgentScript } = await import('../index');

      const result = await runAgentScript<number>('return 42;', {
        securityLevel: 'SECURE',
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
    });
  });
});

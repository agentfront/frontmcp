import { Enclave } from '../enclave';

describe('Enclave Helper Escape Defenses', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Function injection via globals', () => {
    it('should block functions in globals by default', () => {
      // The globals validator now blocks functions by default
      expect(() => {
        new Enclave({
          globals: {
            host: {
              require: () => {
                throw new Error('host require should never run');
              },
            },
          },
        });
      }).toThrow(/function/i);
    });

    it('should block dangerous function patterns even with allowFunctionsInGlobals', () => {
      // Functions containing 'require' in their source are blocked
      expect(() => {
        new Enclave({
          allowFunctionsInGlobals: true,
          globals: {
            host: {
              // This function's source contains 'require' which is blocked
              dangerousFunc: function () {
                return require('fs');
              },
            },
          },
        });
      }).toThrow(/require/i);
    });
  });

  describe('Validation-based blocking', () => {
    it('should block accessing require via trusted host global property', async () => {
      // Using a safe global (no function), but trying to access 'require' property
      const enclave = new Enclave({
        globals: {
          host: {
            safeData: 'no-functions-here',
          },
        },
      });

      const code = `
        const loader = host.require;
        return loader;
      `;

      const result = await enclave.run(code);

      // Should fail validation because 'require' is blocked
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');

      enclave.dispose();
    });

    it('should block bracket access to require', async () => {
      const enclave = new Enclave({
        globals: {
          host: {
            data: 'test',
          },
        },
      });

      const code = `
        const loader = host['require'];
        return loader;
      `;

      const result = await enclave.run(code);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
      expect(result.error?.message).toContain('require');

      enclave.dispose();
    });

    it('should safely handle destructuring from custom globals', async () => {
      const enclave = new Enclave({
        globals: {
          hostHelpers: {
            safeValue: 42,
          },
        },
      });

      const code = `
        const { require: loader } = hostHelpers;
        return loader;
      `;

      const result = await enclave.run(code);

      // Destructuring from a custom global is valid:
      // 1. hostHelpers → __safe_hostHelpers (transformed, in allowed globals)
      // 2. loader is a local binding (NOT transformed)
      // 3. At runtime, loader is undefined (hostHelpers has no 'require' property)
      // This is the correct security model: the host controls what's in custom globals
      expect(result.success).toBe(true);
      expect(result.value).toBeUndefined();

      enclave.dispose();
    });

    it('should block destructuring from dangerous untrusted globals', async () => {
      const enclave = new Enclave({});

      const code = `
        const { require: loader } = globalThis;
        return loader;
      `;

      const result = await enclave.run(code);

      // globalThis is NOT in allowed globals, so __safe_globalThis fails validation
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');

      enclave.dispose();
    });
  });

  it('should block attempts to read sandboxManager via globalThis access', async () => {
    const enclave = new Enclave();

    const code = `
      const manager = globalThis.sandboxManager;
      return manager;
    `;

    const result = await enclave.run(code);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('VALIDATION_ERROR');

    enclave.dispose();
  });
});

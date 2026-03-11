import {
  getEnv,
  getCwd,
  isProduction,
  isDevelopment,
  getEnvFlag,
  isDebug,
  setEnv,
  isEdgeRuntime,
  isServerless,
  supportsAnsi,
} from '../node-env';

describe('Node env utilities', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('getEnv', () => {
    it('should return process.env value', () => {
      process.env['TEST_KEY'] = 'hello';
      expect(getEnv('TEST_KEY')).toBe('hello');
    });

    it('should return undefined for missing key', () => {
      delete process.env['NONEXISTENT_KEY'];
      expect(getEnv('NONEXISTENT_KEY')).toBeUndefined();
    });

    it('should return default when key is missing', () => {
      delete process.env['MISSING_KEY'];
      expect(getEnv('MISSING_KEY', 'fallback')).toBe('fallback');
    });

    it('should return env value over default when key exists', () => {
      process.env['EXISTING'] = 'real';
      expect(getEnv('EXISTING', 'fallback')).toBe('real');
    });
  });

  describe('getCwd', () => {
    it('should return process.cwd()', () => {
      expect(getCwd()).toBe(process.cwd());
    });
  });

  describe('isProduction', () => {
    it('should return true when NODE_ENV is production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isProduction()).toBe(true);
    });

    it('should return false for other values', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isProduction()).toBe(false);
    });

    it('should return false when NODE_ENV is unset', () => {
      delete process.env['NODE_ENV'];
      expect(isProduction()).toBe(false);
    });
  });

  describe('isDevelopment', () => {
    it('should return true when NODE_ENV is development', () => {
      process.env['NODE_ENV'] = 'development';
      expect(isDevelopment()).toBe(true);
    });

    it('should return false for other values', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isDevelopment()).toBe(false);
    });
  });

  describe('getEnvFlag', () => {
    it('should return true for "1"', () => {
      process.env['MY_FLAG'] = '1';
      expect(getEnvFlag('MY_FLAG')).toBe(true);
    });

    it('should return true for "true"', () => {
      process.env['MY_FLAG'] = 'true';
      expect(getEnvFlag('MY_FLAG')).toBe(true);
    });

    it('should return false for "false"', () => {
      process.env['MY_FLAG'] = 'false';
      expect(getEnvFlag('MY_FLAG')).toBe(false);
    });

    it('should return false for "0"', () => {
      process.env['MY_FLAG'] = '0';
      expect(getEnvFlag('MY_FLAG')).toBe(false);
    });

    it('should return false when undefined', () => {
      delete process.env['MY_FLAG'];
      expect(getEnvFlag('MY_FLAG')).toBe(false);
    });
  });

  describe('isDebug', () => {
    it('should return true when DEBUG is "1"', () => {
      process.env['DEBUG'] = '1';
      expect(isDebug()).toBe(true);
    });

    it('should return true when DEBUG is "true"', () => {
      process.env['DEBUG'] = 'true';
      expect(isDebug()).toBe(true);
    });

    it('should return false when DEBUG is unset', () => {
      delete process.env['DEBUG'];
      expect(isDebug()).toBe(false);
    });
  });

  describe('setEnv', () => {
    it('should set process.env value', () => {
      setEnv('SET_TEST', 'newvalue');
      expect(process.env['SET_TEST']).toBe('newvalue');
    });
  });

  describe('isEdgeRuntime', () => {
    it('should return true when EDGE_RUNTIME and VERCEL_ENV are set', () => {
      process.env['EDGE_RUNTIME'] = 'edge';
      process.env['VERCEL_ENV'] = 'production';
      expect(isEdgeRuntime()).toBe(true);
    });

    it('should return false when only EDGE_RUNTIME is set', () => {
      process.env['EDGE_RUNTIME'] = 'edge';
      delete process.env['VERCEL_ENV'];
      // Also need to make sure globalThis doesn't have EdgeRuntime
      expect(isEdgeRuntime()).toBe(false);
    });

    it('should return false when neither is set', () => {
      delete process.env['EDGE_RUNTIME'];
      delete process.env['VERCEL_ENV'];
      expect(isEdgeRuntime()).toBe(false);
    });

    it('should return true when globalThis has EdgeRuntime', () => {
      (globalThis as any).EdgeRuntime = 'edge';
      try {
        expect(isEdgeRuntime()).toBe(true);
      } finally {
        delete (globalThis as any).EdgeRuntime;
      }
    });
  });

  describe('isServerless', () => {
    it('should return false when no serverless env vars are set', () => {
      const serverlessVars = [
        'VERCEL',
        'NETLIFY',
        'CF_PAGES',
        'AWS_LAMBDA_FUNCTION_NAME',
        'AZURE_FUNCTIONS_ENVIRONMENT',
        'K_SERVICE',
        'RAILWAY_ENVIRONMENT',
        'RENDER',
        'FLY_APP_NAME',
      ];
      for (const v of serverlessVars) delete process.env[v];
      expect(isServerless()).toBe(false);
    });

    it.each([
      'VERCEL',
      'NETLIFY',
      'CF_PAGES',
      'AWS_LAMBDA_FUNCTION_NAME',
      'AZURE_FUNCTIONS_ENVIRONMENT',
      'K_SERVICE',
      'RAILWAY_ENVIRONMENT',
      'RENDER',
      'FLY_APP_NAME',
    ])('should return true when %s is set', (envVar) => {
      process.env[envVar] = '1';
      expect(isServerless()).toBe(true);
      delete process.env[envVar];
    });
  });

  describe('supportsAnsi', () => {
    it('should return false when NO_COLOR is set', () => {
      process.env['NO_COLOR'] = '1';
      expect(supportsAnsi()).toBe(false);
    });

    it('should return true when FORCE_COLOR is set', () => {
      delete process.env['NO_COLOR'];
      process.env['FORCE_COLOR'] = '1';
      expect(supportsAnsi()).toBe(true);
    });

    it('should fall back to TTY detection', () => {
      delete process.env['NO_COLOR'];
      delete process.env['FORCE_COLOR'];
      // In a test environment, stdout.isTTY is typically undefined/false
      const result = supportsAnsi();
      expect(typeof result).toBe('boolean');
    });
  });
});

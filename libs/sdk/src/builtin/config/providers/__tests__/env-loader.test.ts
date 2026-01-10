import { setNestedValue, getNestedValue, pathToEnvKey, mapEnvToNestedConfig } from '../env-loader';

describe('env-loader', () => {
  describe('pathToEnvKey', () => {
    it('should convert path to uppercase with underscores', () => {
      expect(pathToEnvKey('database.url')).toBe('DATABASE_URL');
      expect(pathToEnvKey('api.key')).toBe('API_KEY');
      expect(pathToEnvKey('debug')).toBe('DEBUG');
    });
  });

  describe('setNestedValue', () => {
    it('should set a value at a nested path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'database.url', 'postgres://localhost');
      expect(obj).toEqual({ database: { url: 'postgres://localhost' } });
    });

    it('should set a value at a shallow path', () => {
      const obj: Record<string, unknown> = {};
      setNestedValue(obj, 'debug', true);
      expect(obj).toEqual({ debug: true });
    });

    it('should overwrite existing values', () => {
      const obj: Record<string, unknown> = { database: { url: 'old' } };
      setNestedValue(obj, 'database.url', 'new');
      expect(obj).toEqual({ database: { url: 'new' } });
    });

    describe('prototype pollution protection', () => {
      it('should block __proto__ pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, '__proto__.polluted', 'bad');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(({} as any).polluted).toBeUndefined();
        expect(obj).toEqual({});
      });

      it('should block nested __proto__ pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, 'foo.__proto__.polluted', 'bad');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(({} as any).polluted).toBeUndefined();
        expect(obj).toEqual({});
      });

      it('should block constructor pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, 'constructor.prototype.polluted', 'bad');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(({} as any).polluted).toBeUndefined();
        expect(obj).toEqual({});
      });

      it('should block prototype pollution', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, 'prototype.polluted', 'bad');
        expect(obj).toEqual({});
      });

      it('should allow safe keys that look similar', () => {
        const obj: Record<string, unknown> = {};
        setNestedValue(obj, '__proto', 'safe');
        setNestedValue(obj, 'proto__', 'safe');
        setNestedValue(obj, 'constructorValue', 'safe');
        expect(obj).toEqual({
          __proto: 'safe',
          proto__: 'safe',
          constructorValue: 'safe',
        });
      });
    });
  });

  describe('getNestedValue', () => {
    it('should get a value from a nested path', () => {
      const obj = { database: { url: 'postgres://localhost' } };
      expect(getNestedValue(obj, 'database.url')).toBe('postgres://localhost');
    });

    it('should get a value from a shallow path', () => {
      const obj = { debug: true };
      expect(getNestedValue(obj, 'debug')).toBe(true);
    });

    it('should return undefined for non-existent paths', () => {
      const obj = { database: { url: 'postgres://localhost' } };
      expect(getNestedValue(obj, 'database.port')).toBeUndefined();
      expect(getNestedValue(obj, 'missing.path')).toBeUndefined();
    });

    describe('prototype pollution protection', () => {
      it('should block __proto__ access', () => {
        const obj = { foo: 'bar' };
        expect(getNestedValue(obj, '__proto__')).toBeUndefined();
      });

      it('should block nested __proto__ access', () => {
        const obj = { foo: { bar: 'baz' } };
        expect(getNestedValue(obj, 'foo.__proto__')).toBeUndefined();
      });

      it('should block constructor access', () => {
        const obj = { foo: 'bar' };
        expect(getNestedValue(obj, 'constructor')).toBeUndefined();
      });

      it('should block prototype access', () => {
        const obj = { foo: 'bar' };
        expect(getNestedValue(obj, 'prototype')).toBeUndefined();
      });
    });
  });

  describe('mapEnvToNestedConfig', () => {
    it('should map flat env vars to nested config', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost',
        DATABASE_PORT: '5432',
        DEBUG: 'true',
      };
      const paths = ['database.url', 'database.port', 'debug'];
      const result = mapEnvToNestedConfig(env, paths);

      expect(result).toEqual({
        database: {
          url: 'postgres://localhost',
          port: '5432',
        },
        debug: 'true',
      });
    });

    it('should skip missing env vars', () => {
      const env = {
        DATABASE_URL: 'postgres://localhost',
      };
      const paths = ['database.url', 'database.port'];
      const result = mapEnvToNestedConfig(env, paths);

      expect(result).toEqual({
        database: {
          url: 'postgres://localhost',
        },
      });
    });
  });
});

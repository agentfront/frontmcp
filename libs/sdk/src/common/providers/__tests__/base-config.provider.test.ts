// file: libs/sdk/src/common/providers/__tests__/base-config.provider.test.ts

import { BaseConfig } from '../base-config.provider';

interface TestConfig {
  server: {
    host: string;
    port: number;
    ssl: {
      enabled: boolean;
      certPath?: string;
    };
  };
  database: {
    url: string;
    poolSize: number;
  };
  features: {
    auth: boolean;
    logging: boolean;
  };
  apiKey?: string;
}

class TestConfigProvider extends BaseConfig<TestConfig> {
  constructor(config: TestConfig) {
    super(config);
  }
}

describe('BaseConfig', () => {
  let config: TestConfigProvider;

  beforeEach(() => {
    config = new TestConfigProvider({
      server: {
        host: 'localhost',
        port: 3000,
        ssl: {
          enabled: true,
          certPath: '/path/to/cert',
        },
      },
      database: {
        url: 'postgres://localhost/db',
        poolSize: 10,
      },
      features: {
        auth: true,
        logging: false,
      },
    });
  });

  describe('get() - dotted path access', () => {
    it('should get top-level values', () => {
      expect(config.get('apiKey')).toBeUndefined();
    });

    it('should get nested values with dotted path', () => {
      expect(config.get('server.host')).toBe('localhost');
      expect(config.get('server.port')).toBe(3000);
      expect(config.get('database.url')).toBe('postgres://localhost/db');
      expect(config.get('database.poolSize')).toBe(10);
    });

    it('should get deeply nested values', () => {
      expect(config.get('server.ssl.enabled')).toBe(true);
      expect(config.get('server.ssl.certPath')).toBe('/path/to/cert');
    });

    it('should return undefined for non-existent paths', () => {
      expect(config.get('nonexistent.path' as any)).toBeUndefined();
    });

    it('should handle boolean values correctly', () => {
      expect(config.get('features.auth')).toBe(true);
      expect(config.get('features.logging')).toBe(false);
    });

    it('should get value with default when value exists', () => {
      expect(config.get('server.port', 8080)).toBe(3000);
      expect(config.get('server.host', 'example.com')).toBe('localhost');
    });

    it('should return default when value is undefined', () => {
      expect(config.get('apiKey' as any, 'default-key')).toBe('default-key');
      expect(config.get('nonexistent.path' as any, 'fallback')).toBe('fallback');
    });

    it('should work with default for nested paths', () => {
      expect(config.get('server.ssl.enabled', false)).toBe(true);
      expect(config.get('server.ssl.nonexistent' as any, 'default')).toBe('default');
    });
  });

  describe('getAll()', () => {
    it('should return the complete configuration', () => {
      const all = config.getAll();
      expect(all.server.host).toBe('localhost');
      expect(all.server.port).toBe(3000);
      expect(all.database.url).toBe('postgres://localhost/db');
    });
  });

  describe('has()', () => {
    it('should return true for existing paths', () => {
      expect(config.has('server.host')).toBe(true);
      expect(config.has('server.ssl.enabled')).toBe(true);
      expect(config.has('database.poolSize')).toBe(true);
    });

    it('should return false for non-existent paths', () => {
      expect(config.has('nonexistent')).toBe(false);
      expect(config.has('server.nonexistent')).toBe(false);
      expect(config.has('server.ssl.nonexistent')).toBe(false);
    });

    it('should return false for undefined optional values', () => {
      expect(config.has('apiKey')).toBe(false);
    });
  });

  describe('getOrDefault()', () => {
    it('should return value if it exists', () => {
      expect(config.getOrDefault('server.port', 8080)).toBe(3000);
      expect(config.getOrDefault('server.host', 'example.com')).toBe('localhost');
    });

    it('should return default if value is undefined', () => {
      expect(config.getOrDefault('apiKey' as any, 'default-key')).toBe('default-key');
    });

    it('should work with nested paths', () => {
      expect(config.getOrDefault('server.ssl.enabled', false)).toBe(true);
    });
  });

  describe('getRequired()', () => {
    it('should return value if it exists', () => {
      expect(config.getRequired('server.host')).toBe('localhost');
      expect(config.getRequired('server.port')).toBe(3000);
    });

    it('should throw error if value is undefined', () => {
      expect(() => {
        config.getRequired('apiKey' as any);
      }).toThrow('Required configuration path "apiKey" is undefined');
    });
  });

  describe('getOrThrow()', () => {
    it('should return value if it exists', () => {
      expect(config.getOrThrow('server.host')).toBe('localhost');
      expect(config.getOrThrow('server.port')).toBe(3000);
      expect(config.getOrThrow('server.ssl.enabled')).toBe(true);
    });

    it('should throw error if value is undefined', () => {
      expect(() => {
        config.getOrThrow('apiKey' as any);
      }).toThrow('Required configuration path "apiKey" is undefined');
    });

    it('should throw error for non-existent nested paths', () => {
      expect(() => {
        config.getOrThrow('server.nonexistent' as any);
      }).toThrow('Required configuration path "server.nonexistent" is undefined');
    });
  });

  describe('getSection()', () => {
    it('should return entire section', () => {
      const serverConfig = config.getSection('server');
      expect(serverConfig.host).toBe('localhost');
      expect(serverConfig.port).toBe(3000);
      expect(serverConfig.ssl.enabled).toBe(true);
    });

    it('should return database section', () => {
      const dbConfig = config.getSection('database');
      expect(dbConfig.url).toBe('postgres://localhost/db');
      expect(dbConfig.poolSize).toBe(10);
    });

    it('should return features section', () => {
      const features = config.getSection('features');
      expect(features.auth).toBe(true);
      expect(features.logging).toBe(false);
    });
  });

  describe('matches()', () => {
    it('should return true when value matches', () => {
      expect(config.matches('server.host', 'localhost')).toBe(true);
      expect(config.matches('server.port', 3000)).toBe(true);
      expect(config.matches('server.ssl.enabled', true)).toBe(true);
    });

    it('should return false when value does not match', () => {
      expect(config.matches('server.host', 'example.com')).toBe(false);
      expect(config.matches('server.port', 8080)).toBe(false);
      expect(config.matches('server.ssl.enabled', false)).toBe(false);
    });
  });

  describe('getMany()', () => {
    it('should return multiple values at once', () => {
      const values = config.getMany(['server.host', 'server.port', 'database.url']);
      expect(values['server.host']).toBe('localhost');
      expect(values['server.port']).toBe(3000);
      expect(values['database.url']).toBe('postgres://localhost/db');
    });

    it('should handle empty array', () => {
      const values = config.getMany([]);
      expect(Object.keys(values).length).toBe(0);
    });
  });

  describe('toJSON()', () => {
    it('should return configuration as JSON', () => {
      const json = config.toJSON();
      expect(json.server.host).toBe('localhost');
      expect(json.database.poolSize).toBe(10);
    });
  });

  describe('toString()', () => {
    it('should return configuration as formatted JSON string', () => {
      const str = config.toString();
      expect(str).toContain('"host": "localhost"');
      expect(str).toContain('"port": 3000');
      expect(typeof str).toBe('string');
    });
  });
});

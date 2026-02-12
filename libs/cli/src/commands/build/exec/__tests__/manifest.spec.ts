import { generateManifest } from '../manifest';
import { FrontmcpExecConfig } from '../config';

describe('manifest', () => {
  describe('generateManifest', () => {
    it('should generate manifest with defaults', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        version: '1.0.0',
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');

      expect(manifest.name).toBe('test-app');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.nodeVersion).toBe('>=22.0.0');
      expect(manifest.bundle).toBe('test-app.bundle.js');
      expect(manifest.storage).toEqual({ type: 'none', required: false });
      expect(manifest.network).toEqual({ defaultPort: 3001, supportsSocket: true });
      expect(manifest.dependencies).toEqual({ system: [], nativeAddons: [] });
      expect(manifest.setup).toBeUndefined();
    });

    it('should include storage config', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        storage: { type: 'sqlite', required: true },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.storage).toEqual({ type: 'sqlite', required: true });
    });

    it('should include network config', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        network: { defaultPort: 8080, supportsSocket: false },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.network).toEqual({ defaultPort: 8080, supportsSocket: false });
    });

    it('should include dependencies', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        dependencies: {
          system: ['curl'],
          nativeAddons: ['better-sqlite3'],
        },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.dependencies).toEqual({
        system: ['curl'],
        nativeAddons: ['better-sqlite3'],
      });
    });

    it('should serialize setup steps with JSON schema', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        setup: {
          steps: [
            {
              id: 'port',
              prompt: 'Port number',
              jsonSchema: { type: 'number', minimum: 1, maximum: 65535 },
              env: 'PORT',
              group: 'Network',
            },
          ],
        },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.setup).toBeDefined();
      expect(manifest.setup!.steps).toHaveLength(1);
      expect(manifest.setup!.steps[0].id).toBe('port');
      expect(manifest.setup!.steps[0].jsonSchema).toEqual({
        type: 'number',
        minimum: 1,
        maximum: 65535,
      });
      expect(manifest.setup!.steps[0].env).toBe('PORT');
    });

    it('should derive env name from id when not specified', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        setup: {
          steps: [
            {
              id: 'auth-type',
              prompt: 'Auth type',
              jsonSchema: { type: 'string' },
            },
          ],
        },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.setup!.steps[0].env).toBe('AUTH_TYPE');
    });
  });
});

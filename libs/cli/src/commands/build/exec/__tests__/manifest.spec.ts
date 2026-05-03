import { generateManifest } from '../manifest';
import { type FrontmcpExecConfig } from '../config';

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
      // #371: default port is 3000 (Express default — what the server
      // actually binds), not the legacy phantom 3001.
      expect(manifest.network).toEqual({ defaultPort: 3000, supportsSocket: true });
      expect(manifest.dependencies).toEqual({ system: [], nativeAddons: [] });
      expect(manifest.setup).toBeUndefined();
    });

    // #371 — port resolution precedence: build-config > decorator > default
    describe('network.defaultPort precedence (#371)', () => {
      it('uses frontmcp.config network.defaultPort when set (highest precedence)', () => {
        const config: FrontmcpExecConfig = {
          name: 'a',
          network: { defaultPort: 8080 },
        };
        const m = generateManifest(config, 'a.bundle.js', { decoratorHttpPort: 9999 });
        expect(m.network?.defaultPort).toBe(8080);
      });

      it('falls back to decorator http.port when build-config does not set port', () => {
        const config: FrontmcpExecConfig = { name: 'a' };
        const m = generateManifest(config, 'a.bundle.js', { decoratorHttpPort: 4242 });
        expect(m.network?.defaultPort).toBe(4242);
      });

      it('falls back to 3000 when neither build-config nor decorator set port', () => {
        const config: FrontmcpExecConfig = { name: 'a' };
        const m = generateManifest(config, 'a.bundle.js');
        expect(m.network?.defaultPort).toBe(3000);
      });

      it('omits the network section entirely for --target cli builds', () => {
        const config: FrontmcpExecConfig = { name: 'a' };
        const m = generateManifest(config, 'a.bundle.js', { target: 'cli' });
        expect(m.network).toBeUndefined();
      });
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

    it('should call zodSchemaToJsonSchema when step has schema (not jsonSchema)', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        setup: {
          steps: [
            {
              id: 'test-step',
              prompt: 'Enter value',
              schema: 'fake-zod-schema',
            },
          ],
        },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.setup!.steps[0].jsonSchema).toBeDefined();
      // zodSchemaToJsonSchema falls back to { type: 'string' } when zod is not available
      expect(manifest.setup!.steps[0].jsonSchema).toEqual({ type: 'string' });
    });

    it('should default to { type: "string" } when step has neither schema nor jsonSchema', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        setup: {
          steps: [
            {
              id: 'bare-step',
              prompt: 'Enter value',
            },
          ],
        },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      expect(manifest.setup!.steps[0].jsonSchema).toEqual({ type: 'string' });
    });

    it('should serialize all optional fields (sensitive, group, next, showWhen)', () => {
      const config: FrontmcpExecConfig = {
        name: 'test-app',
        setup: {
          steps: [
            {
              id: 'secret',
              prompt: 'Enter secret',
              description: 'A secret value',
              jsonSchema: { type: 'string' },
              sensitive: true,
              group: 'Security',
              next: { yes: 'next-step' },
              showWhen: { prev: 'enabled' },
            },
            {
              id: 'next-step',
              prompt: 'Next',
              jsonSchema: { type: 'string' },
            },
          ],
        },
      };

      const manifest = generateManifest(config, 'test-app.bundle.js');
      const step = manifest.setup!.steps[0];
      expect(step.sensitive).toBe(true);
      expect(step.group).toBe('Security');
      expect(step.next).toEqual({ yes: 'next-step' });
      expect(step.showWhen).toEqual({ prev: 'enabled' });
      expect(step.description).toBe('A secret value');
    });
  });
});

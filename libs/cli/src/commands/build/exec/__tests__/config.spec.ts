import * as path from 'path';
import * as fs from 'fs';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
}));

import { normalizeConfig, loadExecConfig, type FrontmcpExecConfig } from '../config';

const mockFs = fs as jest.Mocked<typeof fs>;

jest.mock('/test-cwd/frontmcp.config.js', () => ({
  default: { name: 'js-app', version: '2.0.0' },
}), { virtual: true });

jest.mock('/test-cwd-mod/frontmcp.config.js', () => ({
  name: 'mod-app', version: '3.0.0',
}), { virtual: true });

describe('config', () => {
  describe('normalizeConfig', () => {
    it('should accept valid config', () => {
      const config: FrontmcpExecConfig = {
        name: 'my-app',
        version: '1.2.3',
      };
      const result = normalizeConfig(config);
      expect(result.name).toBe('my-app');
      expect(result.version).toBe('1.2.3');
      expect(result.nodeVersion).toBe('>=22.0.0');
    });

    it('should set defaults for missing optional fields', () => {
      const config: FrontmcpExecConfig = {
        name: 'test',
      };
      const result = normalizeConfig(config);
      expect(result.version).toBe('1.0.0');
      expect(result.nodeVersion).toBe('>=22.0.0');
    });

    it('should reject invalid app name', () => {
      const config: FrontmcpExecConfig = {
        name: 'invalid name with spaces',
      };
      expect(() => normalizeConfig(config)).toThrow('Invalid app name');
    });

    it('should reject empty app name', () => {
      const config: FrontmcpExecConfig = {
        name: '',
      };
      expect(() => normalizeConfig(config)).toThrow('Invalid app name');
    });

    it('should accept name with dots, hyphens, underscores', () => {
      const config: FrontmcpExecConfig = {
        name: 'my-app_v1.0',
      };
      const result = normalizeConfig(config);
      expect(result.name).toBe('my-app_v1.0');
    });

    it('should preserve custom nodeVersion', () => {
      const config: FrontmcpExecConfig = {
        name: 'test',
        nodeVersion: '>=20.0.0',
      };
      const result = normalizeConfig(config);
      expect(result.nodeVersion).toBe('>=20.0.0');
    });
  });

  describe('loadExecConfig', () => {
    beforeEach(() => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      (mockFs.readFileSync as jest.Mock).mockReset();
    });

    it('should load JSON config from frontmcp.config.json', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('frontmcp.config.js') ? false : p.endsWith('frontmcp.config.json'),
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ name: 'json-app', version: '1.5.0' }));

      const config = await loadExecConfig('/test-cwd');

      expect(config.name).toBe('json-app');
      expect(config.version).toBe('1.5.0');
    });

    it('should load JS config with default export', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('frontmcp.config.js'),
      );

      const config = await loadExecConfig('/test-cwd');

      expect(config.name).toBe('js-app');
      expect(config.version).toBe('2.0.0');
    });

    it('should load JS config with module export (no default)', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('frontmcp.config.js'),
      );

      const config = await loadExecConfig('/test-cwd-mod');

      expect(config.name).toBe('mod-app');
      expect(config.version).toBe('3.0.0');
    });

    it('should try config filenames in priority order', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(loadExecConfig('/nonexistent')).rejects.toThrow();

      expect((mockFs.existsSync as jest.Mock)).toHaveBeenCalledWith(path.join('/nonexistent', 'frontmcp.config.js'));
      expect((mockFs.existsSync as jest.Mock)).toHaveBeenCalledWith(path.join('/nonexistent', 'frontmcp.config.json'));
      expect((mockFs.existsSync as jest.Mock)).toHaveBeenCalledWith(path.join('/nonexistent', 'frontmcp.config.mjs'));
      expect((mockFs.existsSync as jest.Mock)).toHaveBeenCalledWith(path.join('/nonexistent', 'frontmcp.config.cjs'));
    });

    it('should fall back to package.json when no config file', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('package.json'),
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ name: 'pkg-app', version: '4.0.0', main: 'src/index.ts' }));

      const config = await loadExecConfig('/test-cwd');

      expect(config.name).toBe('pkg-app');
      expect(config.version).toBe('4.0.0');
      expect(config.entry).toBe('src/index.ts');
    });

    it('should strip scoped name from package.json', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('package.json'),
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ name: '@scope/my-pkg' }));

      const config = await loadExecConfig('/test-cwd');

      expect(config.name).toBe('my-pkg');
    });

    it('should use path.basename(cwd) when pkg has no name', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('package.json'),
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({}));

      const config = await loadExecConfig('/some/project-dir');

      expect(config.name).toBe('project-dir');
    });

    it('should default version to 1.0.0 when pkg has no version', async () => {
      (mockFs.existsSync as jest.Mock).mockImplementation((p: string) =>
        typeof p === 'string' && p.endsWith('package.json'),
      );
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({ name: 'app' }));

      const config = await loadExecConfig('/test-cwd');

      expect(config.version).toBe('1.0.0');
    });

    describe('config location and version fallback', () => {
      const configsAt = (files: Record<string, string>) => {
        (mockFs.existsSync as jest.Mock).mockImplementation((p: string) => typeof p === 'string' && p in files);
        (mockFs.readFileSync as jest.Mock).mockImplementation((p: string) => files[p]);
      };

      it('reads the explicit configPath (absolute)', async () => {
        configsAt({ '/elsewhere/custom.json': JSON.stringify({ name: 'custom-app', version: '9.0.0' }) });

        const config = await loadExecConfig('/test-cwd', { configPath: '/elsewhere/custom.json' });

        expect(config.name).toBe('custom-app');
        expect(config.version).toBe('9.0.0');
      });

      it('resolves a relative configPath against cwd', async () => {
        configsAt({ [path.resolve('/test-cwd', 'cfg/app.json')]: JSON.stringify({ name: 'rel-app', version: '1.1.1' }) });

        const config = await loadExecConfig('/test-cwd', { configPath: 'cfg/app.json' });

        expect(config.name).toBe('rel-app');
      });

      it('throws a clear error when the explicit configPath does not exist', async () => {
        configsAt({});

        await expect(loadExecConfig('/test-cwd', { configPath: 'nope.json' })).rejects.toThrow(
          'Config file not found: nope.json',
        );
      });

      it('prefers configPath over configDir', async () => {
        configsAt({
          '/elsewhere/custom.json': JSON.stringify({ name: 'explicit', version: '1.0.0' }),
          [path.join('/parent', 'frontmcp.config.json')]: JSON.stringify({ name: 'parent', version: '1.0.0' }),
        });

        const config = await loadExecConfig('/test-cwd', {
          configPath: '/elsewhere/custom.json',
          configDir: '/parent',
        });

        expect(config.name).toBe('explicit');
      });

      it('finds frontmcp.config.* in configDir when it lives above cwd', async () => {
        configsAt({
          [path.join('/monorepo', 'frontmcp.config.json')]: JSON.stringify({ name: 'root-app', version: '2.2.2' }),
        });

        const config = await loadExecConfig('/monorepo/packages/app', { configDir: '/monorepo' });

        expect(config.name).toBe('root-app');
        expect(config.version).toBe('2.2.2');
      });

      it('inherits the package.json version when the config omits one', async () => {
        configsAt({
          [path.join('/test-cwd', 'frontmcp.config.json')]: JSON.stringify({ name: 'no-version' }),
          [path.join('/test-cwd', 'package.json')]: JSON.stringify({ name: 'pkg', version: '7.7.7' }),
        });

        const config = await loadExecConfig('/test-cwd');

        expect(config.version).toBe('7.7.7');
      });

      it('keeps the config version over the package.json version', async () => {
        configsAt({
          [path.join('/test-cwd', 'frontmcp.config.json')]: JSON.stringify({ name: 'v', version: '3.0.0' }),
          [path.join('/test-cwd', 'package.json')]: JSON.stringify({ name: 'pkg', version: '7.7.7' }),
        });

        const config = await loadExecConfig('/test-cwd');

        expect(config.version).toBe('3.0.0');
      });
    });

    it('should throw when no config files and no package.json', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(loadExecConfig('/nonexistent')).rejects.toThrow(
        'No frontmcp.config.js/json found',
      );
    });
  });
});

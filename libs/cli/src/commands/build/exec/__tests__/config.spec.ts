import * as path from 'path';
import * as fs from 'fs';

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn(),
}));

import { normalizeConfig, loadExecConfig, FrontmcpExecConfig } from '../config';

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

    it('should throw when no config files and no package.json', async () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      await expect(loadExecConfig('/nonexistent')).rejects.toThrow(
        'No frontmcp.config.js/json found',
      );
    });
  });
});

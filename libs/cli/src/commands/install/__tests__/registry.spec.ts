import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Mock pm.paths before importing registry
const tmpDir = path.join(os.tmpdir(), 'frontmcp-registry-test-' + Date.now());

jest.mock('../../../pm/pm.paths', () => ({
  registryPath: () => path.join(tmpDir, 'registry.json'),
  ensurePmDirs: () => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  },
}));

import {
  readRegistry,
  writeRegistry,
  registerApp,
  unregisterApp,
  getRegisteredApp,
  listRegisteredApps,
} from '../registry';

describe('install registry', () => {
  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean registry before each test
    const regPath = path.join(tmpDir, 'registry.json');
    if (fs.existsSync(regPath)) {
      fs.unlinkSync(regPath);
    }
  });

  describe('readRegistry', () => {
    it('should return empty registry when file does not exist', () => {
      const reg = readRegistry();
      expect(reg.version).toBe(1);
      expect(reg.apps).toEqual({});
    });
  });

  describe('registerApp / getRegisteredApp', () => {
    it('should register and retrieve an app', () => {
      registerApp('test-app', {
        version: '1.0.0',
        installDir: '/home/user/.frontmcp/apps/test-app',
        installedAt: '2024-01-01T00:00:00Z',
        runner: '/home/user/.frontmcp/apps/test-app/test-app',
        bundle: '/home/user/.frontmcp/apps/test-app/test-app.bundle.js',
        storage: 'sqlite',
        port: 3001,
      });

      const app = getRegisteredApp('test-app');
      expect(app).not.toBeNull();
      expect(app!.version).toBe('1.0.0');
      expect(app!.storage).toBe('sqlite');
    });

    it('should return null for non-existent app', () => {
      expect(getRegisteredApp('nonexistent')).toBeNull();
    });
  });

  describe('unregisterApp', () => {
    it('should remove a registered app', () => {
      registerApp('to-remove', {
        version: '1.0.0',
        installDir: '/path',
        installedAt: '2024-01-01T00:00:00Z',
        runner: '/path/runner',
        bundle: '/path/bundle.js',
        storage: 'none',
        port: 3001,
      });

      expect(unregisterApp('to-remove')).toBe(true);
      expect(getRegisteredApp('to-remove')).toBeNull();
    });

    it('should return false for non-existent app', () => {
      expect(unregisterApp('nonexistent')).toBe(false);
    });
  });

  describe('listRegisteredApps', () => {
    it('should list all registered apps', () => {
      registerApp('app-1', {
        version: '1.0.0',
        installDir: '/path/1',
        installedAt: '2024-01-01T00:00:00Z',
        runner: '/path/1/runner',
        bundle: '/path/1/bundle.js',
        storage: 'none',
        port: 3001,
      });
      registerApp('app-2', {
        version: '2.0.0',
        installDir: '/path/2',
        installedAt: '2024-01-02T00:00:00Z',
        runner: '/path/2/runner',
        bundle: '/path/2/bundle.js',
        storage: 'redis',
        port: 3002,
      });

      const apps = listRegisteredApps();
      expect(apps).toHaveLength(2);
      expect(apps.map((a) => a.name).sort()).toEqual(['app-1', 'app-2']);
    });

    it('should return empty list when no apps registered', () => {
      expect(listRegisteredApps()).toEqual([]);
    });
  });
});

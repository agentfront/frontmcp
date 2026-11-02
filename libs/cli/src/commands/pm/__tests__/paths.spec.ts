import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { appDir, errorLogFilePath, logFilePath, pidFilePath, PM_DIRS, registryPath, socketFilePath } from '../paths';

describe('pm.paths', () => {
  const home = os.homedir();
  const root = path.join(home, '.frontmcp');

  describe('PM_DIRS', () => {
    it('should define root directory under home', () => {
      expect(PM_DIRS.root).toBe(root);
    });

    it('should define pids directory', () => {
      expect(PM_DIRS.pids).toBe(path.join(root, 'pids'));
    });

    it('should define logs directory', () => {
      expect(PM_DIRS.logs).toBe(path.join(root, 'logs'));
    });

    it('should define sockets directory', () => {
      expect(PM_DIRS.sockets).toBe(path.join(root, 'sockets'));
    });

    it('should define services directory', () => {
      expect(PM_DIRS.services).toBe(path.join(root, 'services'));
    });

    it('should define apps directory', () => {
      expect(PM_DIRS.apps).toBe(path.join(root, 'apps'));
    });

    it('should define data directory', () => {
      expect(PM_DIRS.data).toBe(path.join(root, 'data'));
    });
  });

  describe('file path helpers', () => {
    it('should resolve pid file path', () => {
      expect(pidFilePath('my-app')).toBe(path.join(root, 'pids', 'my-app.pid'));
    });

    it('should resolve log file path', () => {
      expect(logFilePath('my-app')).toBe(path.join(root, 'logs', 'my-app.log'));
    });

    it('should resolve error log file path', () => {
      expect(errorLogFilePath('my-app')).toBe(path.join(root, 'logs', 'my-app.error.log'));
    });

    it('should resolve socket file path', () => {
      expect(socketFilePath('my-app')).toBe(path.join(root, 'sockets', 'my-app.sock'));
    });

    it('should resolve app directory', () => {
      expect(appDir('my-app')).toBe(path.join(root, 'apps', 'my-app'));
    });

    it('should resolve registry path', () => {
      expect(registryPath()).toBe(path.join(root, 'registry.json'));
    });
  });
});

describe('pm sockets directory', () => {
  const posixIt = process.platform === 'win32' ? it.skip : it;
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-home-'));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  function pathsUnder(homeDir: string): typeof import('../paths') {
    let loaded: typeof import('../paths') | undefined;
    jest.isolateModules(() => {
      jest.doMock('os', () => ({ ...jest.requireActual('os'), homedir: () => homeDir }));
      loaded = require('../paths');
    });
    jest.dontMock('os');
    if (!loaded) throw new Error('paths module did not load');
    return loaded;
  }

  posixIt('creates ~/.frontmcp/sockets owner-only (0700)', () => {
    const paths = pathsUnder(home);

    paths.ensurePmDirs();

    expect(fs.statSync(paths.PM_DIRS.sockets).mode & 0o777).toBe(0o700);
  });

  posixIt('tightens a sockets directory an earlier version created with the default mode', () => {
    const paths = pathsUnder(home);
    fs.mkdirSync(paths.PM_DIRS.sockets, { recursive: true, mode: 0o775 });
    fs.chmodSync(paths.PM_DIRS.sockets, 0o775);

    paths.ensureSocketsDir();

    expect(fs.statSync(paths.PM_DIRS.sockets).mode & 0o777).toBe(0o700);
  });
});

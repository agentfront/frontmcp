import { buildStartArgs, detectPlatform, generateLaunchdPlist, generateSystemdUnit } from '../service-gen';

describe('pm.service', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('detectPlatform', () => {
    it('should return launchd on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(detectPlatform()).toBe('launchd');
    });

    it('should return systemd on linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(detectPlatform()).toBe('systemd');
    });

    it('should throw on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(() => detectPlatform()).toThrow('Windows is not supported');
    });
  });
});

describe('pm.service generated units keep the start flags (#642)', () => {
  const data = {
    name: 'my-app',
    entry: '/srv/app/src/main.ts',
    port: 4100,
    socketPath: '/tmp/my-app.sock',
    dbPath: '/var/data/my-app.sqlite',
    maxRestarts: 9,
  };

  it('buildStartArgs includes port, socket, db and max restarts', () => {
    expect(buildStartArgs(data)).toEqual([
      'start',
      'my-app',
      '--entry',
      '/srv/app/src/main.ts',
      '--port',
      '4100',
      '--socket',
      '/tmp/my-app.sock',
      '--db',
      '/var/data/my-app.sqlite',
      '--max-restarts',
      '9',
    ]);
  });

  it('buildStartArgs omits flags that were not used', () => {
    expect(buildStartArgs({ name: 'a', entry: 'e.ts' })).toEqual(['start', 'a', '--entry', 'e.ts']);
  });

  it('systemd unit passes --port to `frontmcp start`', () => {
    const unit = generateSystemdUnit(data);
    expect(unit).toContain('"--port" "4100"');
    expect(unit).toContain('"--socket" "/tmp/my-app.sock"');
    expect(unit).toContain('"--db" "/var/data/my-app.sqlite"');
  });

  it('systemd unit escapes literal percent signs in arguments', () => {
    expect(generateSystemdUnit({ name: 'a', entry: '/x/100%/main.ts' })).toContain('"/x/100%%/main.ts"');
  });

  it('launchd plist passes --port to `frontmcp start`', () => {
    const plist = generateLaunchdPlist(data);
    expect(plist).toContain('<string>--port</string>\n    <string>4100</string>');
    expect(plist).toContain('<string>--db</string>');
  });

  it('launchd plist escapes XML characters in arguments', () => {
    expect(generateLaunchdPlist({ name: 'a', entry: '/x/a&b<c>.ts' })).toContain('/x/a&amp;b&lt;c&gt;.ts');
  });
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  binaryFileName,
  buildPlatformOverrides,
  mergeBinariesFrom,
  resolveHostPlatform,
  MCPB_PLATFORM_KEYS,
} from '../binary';

describe('resolveHostPlatform', () => {
  it('resolves darwin/arm64', () => {
    expect(resolveHostPlatform('darwin', 'arm64')).toBe('darwin-arm64');
  });
  it('resolves linux/x64', () => {
    expect(resolveHostPlatform('linux', 'x64')).toBe('linux-x64');
  });
  it('returns undefined for unsupported combinations', () => {
    expect(resolveHostPlatform('linux', 'mips64el' as NodeJS.Architecture)).toBeUndefined();
  });
});

describe('binaryFileName', () => {
  it('appends .exe on win32', () => {
    expect(binaryFileName('demo', 'win32-x64')).toBe('demo.exe');
  });
  it('leaves unix names alone', () => {
    expect(binaryFileName('demo', 'darwin-arm64')).toBe('demo');
    expect(binaryFileName('demo', 'linux-x64')).toBe('demo');
  });
});

describe('mergeBinariesFrom', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-merge-'));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns empty for missing directory', () => {
    expect(mergeBinariesFrom(path.join(tmp, 'ghost'), 'demo')).toEqual([]);
  });

  it('collects binaries across supported platforms', () => {
    for (const platform of MCPB_PLATFORM_KEYS) {
      const dir = path.join(tmp, platform);
      fs.mkdirSync(dir, { recursive: true });
      const file = binaryFileName('demo', platform);
      fs.writeFileSync(path.join(dir, file), 'binary');
    }
    const result = mergeBinariesFrom(tmp, 'demo');
    expect(result.map((r) => r.platform).sort()).toEqual([...MCPB_PLATFORM_KEYS].sort());
  });

  it('ignores unrecognized platform folders', () => {
    fs.mkdirSync(path.join(tmp, 'haiku-ppc'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'haiku-ppc', 'demo'), 'bin');
    expect(mergeBinariesFrom(tmp, 'demo')).toEqual([]);
  });
});

describe('buildPlatformOverrides', () => {
  it('emits ${__dirname}/bin/... commands with empty args', () => {
    const overrides = buildPlatformOverrides([
      { platform: 'darwin-arm64', srcPath: '/tmp/demo', fileName: 'demo' },
      { platform: 'win32-x64', srcPath: 'C:\\tmp\\demo.exe', fileName: 'demo.exe' },
    ]);
    expect(overrides['darwin-arm64'].command).toBe('${__dirname}/bin/darwin-arm64/demo');
    expect(overrides['win32-x64'].command).toBe('${__dirname}/bin/win32-x64/demo.exe');
    expect(overrides['darwin-arm64'].args).toEqual([]);
  });

  it('returns empty object for no entries', () => {
    expect(buildPlatformOverrides([])).toEqual({});
  });
});

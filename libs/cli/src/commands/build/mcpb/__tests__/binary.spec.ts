import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import {
  binaryFileName,
  buildPlatformOverrides,
  launcherFiles,
  mergeBinariesFrom,
  osBinaryCoverage,
  resolveHostPlatform,
  MCPB_PLATFORM_KEYS,
  type BinaryEntry,
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

function entry(platform: BinaryEntry['platform']): BinaryEntry {
  return { platform, srcPath: `/ci/${platform}/demo`, fileName: binaryFileName('demo', platform) };
}

describe('buildPlatformOverrides', () => {
  it('keys overrides by OS, the only key MCPB hosts look up', () => {
    const overrides = buildPlatformOverrides(MCPB_PLATFORM_KEYS.map(entry));
    expect(Object.keys(overrides).sort()).toEqual(['darwin', 'linux', 'win32']);
  });

  it('points a single-architecture OS straight at its binary', () => {
    const overrides = buildPlatformOverrides([entry('win32-x64')]);
    expect(overrides['win32']).toEqual({
      command: '${__dirname}/bin/win32-x64/demo.exe',
      args: [],
      env: { FRONTMCP_STDIO: '1' },
    });
  });

  it('points a multi-architecture OS at its launcher', () => {
    const overrides = buildPlatformOverrides([entry('darwin-arm64'), entry('darwin-x64')]);
    expect(overrides['darwin'].command).toBe('${__dirname}/bin/darwin/launch');
  });

  it('gives an OS no override while one of its architectures has no binary', () => {
    expect(buildPlatformOverrides([entry('darwin-arm64'), entry('linux-x64')])).toEqual({});
    expect(osBinaryCoverage([entry('darwin-arm64')])).toEqual([
      { os: 'darwin', binaries: [entry('darwin-arm64')], missing: ['darwin-x64'] },
    ]);
  });

  it('returns empty object for no entries', () => {
    expect(buildPlatformOverrides([])).toEqual({});
  });
});

describe('launcherFiles', () => {
  it('stages a launcher only for a fully covered multi-architecture OS', () => {
    const files = launcherFiles([entry('darwin-arm64'), entry('darwin-x64'), entry('win32-x64'), entry('linux-x64')], 'demo');
    expect(files.map((file) => file.os)).toEqual(['darwin']);
  });

  const posixIt = process.platform === 'win32' ? it.skip : it;
  posixIt('runs the binary built for the host architecture', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpb-launch-'));
    try {
      const machine = execFileSync('uname', ['-m']).toString().trim();
      const hostArch = ['arm64', 'aarch64'].includes(machine) ? 'arm64' : 'x64';
      for (const arch of ['arm64', 'x64']) {
        const dir = path.join(tmp, 'bin', `linux-${arch}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'demo'), `#!/bin/sh\necho ${arch} "$@"\n`, { mode: 0o755 });
      }
      const [launcher] = launcherFiles([entry('linux-arm64'), entry('linux-x64')], 'demo');
      const launcherPath = path.join(tmp, 'bin', 'linux', 'launch');
      fs.mkdirSync(path.dirname(launcherPath), { recursive: true });
      fs.writeFileSync(launcherPath, launcher.content, { mode: 0o755 });

      expect(execFileSync(launcherPath, ['--flag']).toString().trim()).toBe(`${hostArch} --flag`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

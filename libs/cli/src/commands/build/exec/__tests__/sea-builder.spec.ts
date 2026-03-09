import * as path from 'path';
import * as fs from 'fs';

jest.mock('fs', () => ({
  writeFileSync: jest.fn(),
  copyFileSync: jest.fn(),
  chmodSync: jest.fn(),
  unlinkSync: jest.fn(),
  statSync: jest.fn().mockReturnValue({ size: 1000000 }),
}));

jest.mock('@frontmcp/utils', () => ({ runCmd: jest.fn().mockResolvedValue(undefined) }));

jest.mock('../../../../core/colors', () => ({
  c: (_: string, t: string) => t,
}));

import { buildSea } from '../sea-builder';
import { runCmd } from '@frontmcp/utils';

const mockFs = fs as jest.Mocked<typeof fs>;
const mockRunCmd = runCmd as jest.MockedFunction<typeof runCmd>;

let originalPlatform: PropertyDescriptor | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  mockRunCmd.mockResolvedValue(undefined);
  (mockFs.statSync as jest.Mock).mockReturnValue({ size: 1000000 });
  originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }
});

describe('buildSea', () => {
  it('should write SEA config JSON with correct fields', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      path.join('/tmp/out', 'app.sea-config.json'),
      expect.any(String),
    );

    const configJson = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    expect(configJson.main).toBe('/tmp/out/app.bundle.js');
    expect(configJson.output).toBe(path.join('/tmp/out', 'app.blob'));
    expect(configJson.disableExperimentalSEAWarning).toBe(true);
    expect(configJson.useCodeCache).toBe(true);
  });

  it('should run node --experimental-sea-config', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockRunCmd).toHaveBeenCalledWith(
      'node',
      ['--experimental-sea-config', path.join('/tmp/out', 'app.sea-config.json')],
    );
  });

  it('should copy process.execPath and chmod 755', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    const executablePath = path.join('/tmp/out', 'app-bin');
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(process.execPath, executablePath);
    expect(mockFs.chmodSync).toHaveBeenCalledWith(executablePath, 0o755);
  });

  it('should call codesign --remove-signature on macOS before inject', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockRunCmd).toHaveBeenCalledWith(
      'codesign',
      ['--remove-signature', path.join('/tmp/out', 'app-bin')],
    );
  });

  it('should call codesign -s - on macOS after inject', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockRunCmd).toHaveBeenCalledWith(
      'codesign',
      ['-s', '-', path.join('/tmp/out', 'app-bin')],
    );
  });

  it('should catch codesign errors gracefully on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    mockRunCmd.mockImplementation(async (cmd: string) => {
      if (cmd === 'codesign') throw new Error('codesign not available');
    });

    // Should not throw
    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');
  });

  it('should skip codesign on non-macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockRunCmd).not.toHaveBeenCalledWith('codesign', expect.anything());
  });

  it('should run postject with correct args', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockRunCmd).toHaveBeenCalledWith('npx', [
      '-y',
      'postject',
      path.join('/tmp/out', 'app-bin'),
      'NODE_SEA_BLOB',
      path.join('/tmp/out', 'app.blob'),
      '--sentinel-fuse',
      'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ]);
  });

  it('should add --macho-segment-name on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    const postjectCall = mockRunCmd.mock.calls.find(
      (c: unknown[]) => c[0] === 'npx' && (c[1] as string[]).includes('postject'),
    );
    expect(postjectCall).toBeDefined();
    expect(postjectCall![1]).toContain('--macho-segment-name');
    expect(postjectCall![1]).toContain('NODE_SEA');
  });

  it('should not add --macho-segment-name on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    const postjectCall = mockRunCmd.mock.calls.find(
      (c: unknown[]) => c[0] === 'npx' && (c[1] as string[]).includes('postject'),
    );
    expect(postjectCall![1]).not.toContain('--macho-segment-name');
  });

  it('should clean up blob and config files', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join('/tmp/out', 'app.blob'));
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(path.join('/tmp/out', 'app.sea-config.json'));
  });

  it('should return executablePath and executableSize', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    (mockFs.statSync as jest.Mock).mockReturnValue({ size: 50000000 });

    const result = await buildSea('/tmp/out/app.bundle.js', '/tmp/out', 'app');

    expect(result.executablePath).toBe(path.join('/tmp/out', 'app-bin'));
    expect(result.executableSize).toBe(50000000);
  });
});

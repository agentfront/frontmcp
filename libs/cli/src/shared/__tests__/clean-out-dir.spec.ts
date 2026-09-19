// file: libs/cli/src/shared/__tests__/clean-out-dir.spec.ts

import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';

import { ensureDir, fileExists, rm } from '@frontmcp/utils';

import { checkOutDirSafeToClean, cleanOutDir } from '../clean-out-dir';

jest.mock('@frontmcp/utils', () => ({
  ensureDir: jest.fn(async () => undefined),
  fileExists: jest.fn(async () => true),
  rm: jest.fn(async () => undefined),
}));
jest.mock('../../core/colors', () => ({ c: jest.fn((_color: string, text: string) => text) }));

const rmMock = rm as unknown as jest.Mock;
const ensureDirMock = ensureDir as unknown as jest.Mock;
const fileExistsMock = fileExists as unknown as jest.Mock;

const PROJECT = path.resolve(path.sep, 'projects', 'demo');

describe('checkOutDirSafeToClean', () => {
  it('allows a directory inside the project', () => {
    expect(checkOutDirSafeToClean(path.join(PROJECT, 'dist', 'cloudflare'), PROJECT)).toBeUndefined();
  });

  it('refuses the project root itself', () => {
    expect(checkOutDirSafeToClean(PROJECT, PROJECT)).toBe('is-project-root');
  });

  it('refuses a parent of the project root', () => {
    expect(checkOutDirSafeToClean(path.dirname(PROJECT), PROJECT)).toBe('contains-project-root');
  });

  it('refuses a sibling directory outside the project', () => {
    expect(checkOutDirSafeToClean(path.resolve(path.sep, 'projects', 'other'), PROJECT)).toBe('outside-project');
  });

  it('refuses the filesystem root', () => {
    const root = path.parse(PROJECT).root;
    expect(checkOutDirSafeToClean(root, PROJECT)).toBe('filesystem-root');
  });

  it('normalises traversal segments before deciding', () => {
    const escaping = path.join(PROJECT, 'dist', '..', '..', 'elsewhere');
    expect(checkOutDirSafeToClean(escaping, PROJECT)).toBe('outside-project');
  });
});

describe('checkOutDirSafeToClean — symlinked output directories', () => {
  let projectDir: string;
  let outsideDir: string;

  beforeEach(() => {
    const base = mkdtempSync(path.join(tmpdir(), 'frontmcp-clean-'));
    projectDir = path.join(base, 'project');
    outsideDir = path.join(base, 'outside');
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(path.join(outsideDir, 'cloudflare'), { recursive: true });
  });

  afterEach(() => {
    rmSync(path.dirname(projectDir), { recursive: true, force: true });
  });

  it('refuses when a path segment is a symlink that escapes the project', () => {
    symlinkSync(outsideDir, path.join(projectDir, 'dist'), 'dir');

    // Lexically this looks contained; only the resolved path reveals the escape.
    expect(checkOutDirSafeToClean(path.join(projectDir, 'dist', 'cloudflare'), projectDir)).toBe('outside-project');
  });

  it('still allows a real directory inside the project', () => {
    mkdirSync(path.join(projectDir, 'dist', 'cloudflare'), { recursive: true });

    expect(checkOutDirSafeToClean(path.join(projectDir, 'dist', 'cloudflare'), projectDir)).toBeUndefined();
  });

  it('allows a not-yet-created directory inside the project', () => {
    expect(checkOutDirSafeToClean(path.join(projectDir, 'dist', 'node'), projectDir)).toBeUndefined();
  });
});

describe('cleanOutDir (issue #545)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fileExistsMock.mockResolvedValue(true);
  });

  it('removes and recreates a safe output directory', async () => {
    const outDir = path.join(PROJECT, 'dist', 'cloudflare');

    await expect(cleanOutDir(outDir, PROJECT)).resolves.toBe(true);

    expect(rmMock).toHaveBeenCalledWith(outDir, { recursive: true, force: true });
    expect(ensureDirMock).toHaveBeenCalledWith(outDir);
  });

  it('creates the directory without removing anything when it does not exist yet', async () => {
    fileExistsMock.mockResolvedValue(false);
    const outDir = path.join(PROJECT, 'dist', 'node');

    await expect(cleanOutDir(outDir, PROJECT)).resolves.toBe(true);

    expect(rmMock).not.toHaveBeenCalled();
    expect(ensureDirMock).toHaveBeenCalledWith(outDir);
  });

  it('refuses to delete the project root and leaves the build to continue', async () => {
    await expect(cleanOutDir(PROJECT, PROJECT)).resolves.toBe(false);

    expect(rmMock).not.toHaveBeenCalled();
    expect(ensureDirMock).not.toHaveBeenCalled();
  });

  it('refuses to delete a directory outside the project', async () => {
    await expect(cleanOutDir(path.resolve(path.sep, 'etc'), PROJECT)).resolves.toBe(false);

    expect(rmMock).not.toHaveBeenCalled();
  });
});

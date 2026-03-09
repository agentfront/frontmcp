import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ensureBuild, runCli } from './helpers/exec-cli';

describe('CLI Exec Install/Uninstall Commands', () => {
  let prefixDir: string;
  let binDir: string;
  const appName = 'cli-exec-demo';

  beforeAll(async () => {
    await ensureBuild();
    prefixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-install-test-'));
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-bin-test-'));
  });

  afterAll(() => {
    // Run uninstall to clean up
    try {
      runCli(['uninstall', '--prefix', prefixDir, '--bin-dir', binDir]);
    } catch (_) {
      /* ok */
    }
    try {
      fs.rmSync(prefixDir, { recursive: true, force: true });
    } catch (_) {
      /* ok */
    }
    try {
      fs.rmSync(binDir, { recursive: true, force: true });
    } catch (_) {
      /* ok */
    }
  });

  it('install --prefix --bin-dir should copy files', () => {
    const { stdout, exitCode } = runCli(['install', '--prefix', prefixDir, '--bin-dir', binDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Copied');
    expect(stdout).toContain('Installed');
  });

  it('installed dir should contain .js files', () => {
    const appDir = path.join(prefixDir, 'apps', appName);
    expect(fs.existsSync(appDir)).toBe(true);
    const files = fs.readdirSync(appDir);
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);
  });

  it('entry point should have execute permission', () => {
    const appDir = path.join(prefixDir, 'apps', appName);
    // SEA builds use -cli-bin, non-SEA use -cli.bundle.js
    const seaEntry = path.join(appDir, `${appName}-cli-bin`);
    const jsEntry = path.join(appDir, `${appName}-cli.bundle.js`);
    const entryFile = fs.existsSync(seaEntry) ? seaEntry : jsEntry;
    const stats = fs.statSync(entryFile);

    expect(stats.mode & 0o111).not.toBe(0);
  });

  it('symlink should be created in bin-dir', () => {
    const linkPath = path.join(binDir, appName);
    expect(fs.existsSync(linkPath)).toBe(true);
    const stats = fs.lstatSync(linkPath);
    expect(stats.isSymbolicLink()).toBe(true);
  });

  it('uninstall should remove app dir and symlink', () => {
    const { stdout, exitCode } = runCli(['uninstall', '--prefix', prefixDir, '--bin-dir', binDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Uninstalled');

    const appDir = path.join(prefixDir, 'apps', appName);
    expect(fs.existsSync(appDir)).toBe(false);

    const linkPath = path.join(binDir, appName);
    expect(fs.existsSync(linkPath)).toBe(false);
  });
});

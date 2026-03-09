import * as fs from 'fs';
import * as path from 'path';
import { ensureBuild, getDistDir, getServerBundlePath, getCliBundlePath, getManifestPath } from './helpers/exec-cli';

describe('CLI Exec Build Output', () => {
  beforeAll(async () => {
    await ensureBuild();
  });

  it('should produce the server bundle', () => {
    expect(fs.existsSync(getServerBundlePath())).toBe(true);
  });

  it('should produce the CLI bundle', () => {
    expect(fs.existsSync(getCliBundlePath())).toBe(true);
  });

  it('should produce the manifest with correct CLI metadata', () => {
    const manifestPath = getManifestPath();
    expect(fs.existsSync(manifestPath)).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.name).toBe('cli-exec-demo');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.cli).toBeDefined();
    expect(manifest.cli.enabled).toBe(true);
    // toolCount should only count user tools (not system tools like searchSkills, execute-job, etc.)
    expect(manifest.cli.toolCount).toBeGreaterThanOrEqual(4);
    expect(manifest.cli.resourceCount).toBe(1);
    expect(manifest.cli.templateCount).toBe(1);
    expect(manifest.cli.promptCount).toBe(1);
    // Capability flags
    expect(manifest.cli.skillsEnabled).toBe(true);
    expect(manifest.cli.jobsEnabled).toBe(true);
  });

  it('should produce the runner script', () => {
    const runnerPath = path.join(getDistDir(), 'cli-exec-demo');
    expect(fs.existsSync(runnerPath)).toBe(true);

    const content = fs.readFileSync(runnerPath, 'utf-8');
    expect(content).toContain('cli-exec-demo');
  });

  it('should produce the installer script', () => {
    const installerPath = path.join(getDistDir(), 'install-cli-exec-demo.sh');
    expect(fs.existsSync(installerPath)).toBe(true);
  });
});

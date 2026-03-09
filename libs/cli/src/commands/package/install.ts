/**
 * runInstall() orchestrator — installs an MCP app from npm, local, or git source.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { appDir, ensurePmDirs } from '../pm/paths';
import { parseInstallSource } from './types';
import { registerApp } from './registry';
import { runQuestionnaire, writeEnvFile } from './questionnaire';
import { fetchFromNpm } from './sources/npm';
import { fetchFromLocal } from './sources/local';
import { fetchFromGit } from './sources/git';
import { ExecManifest } from '../build/exec/manifest';
import { runCmd } from '@frontmcp/utils';

export async function runInstall(opts: ParsedArgs): Promise<void> {
  const sourceStr = opts._[1];
  if (!sourceStr) {
    throw new Error('Missing install source. Usage: frontmcp install <npm-package|./local-path|github:user/repo>');
  }

  const source = parseInstallSource(sourceStr);
  console.log(`${c('cyan', '[install]')} source: ${source.type} → ${source.ref}`);

  // Create temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frontmcp-install-'));

  try {
    // 1. Fetch to temp directory
    console.log(`${c('cyan', '[install]')} fetching...`);
    let packageDir: string;

    switch (source.type) {
      case 'npm':
        packageDir = await fetchFromNpm(source.ref, tmpDir, opts.registry);
        break;
      case 'local':
        packageDir = await fetchFromLocal(source.ref, tmpDir);
        break;
      case 'git':
        packageDir = await fetchFromGit(source.ref, tmpDir);
        break;
    }

    // 2. Look for manifest
    let manifest = findManifest(packageDir);

    // 3. If no manifest, check for frontmcp.config.js and build
    if (!manifest) {
      const configPath = path.join(packageDir, 'frontmcp.config.js');
      const configJsonPath = path.join(packageDir, 'frontmcp.config.json');

      if (fs.existsSync(configPath) || fs.existsSync(configJsonPath)) {
        console.log(`${c('cyan', '[install]')} no manifest found, building from config...`);
        await runCmd('npx', ['frontmcp', 'build', '--exec'], {
          cwd: packageDir,
        });
        manifest = findManifest(path.join(packageDir, 'dist')) || findManifest(packageDir);
      }
    }

    if (!manifest) {
      throw new Error(
        'Could not find or generate a manifest. Ensure the package has a ' +
          'frontmcp.config.js or was built with "frontmcp build --exec".',
      );
    }

    const { data: manifestData, dir: manifestDir } = manifest;

    // 4. Install to ~/.frontmcp/apps/{name}/
    const installDir = appDir(manifestData.name);
    ensurePmDirs();
    fs.mkdirSync(installDir, { recursive: true });

    console.log(`${c('cyan', '[install]')} installing "${manifestData.name}" to ${installDir}`);

    // Copy bundle + manifest + runner
    copyIfExists(manifestDir, installDir, manifestData.bundle);
    copyIfExists(manifestDir, installDir, `${manifestData.name}.manifest.json`);
    copyIfExists(manifestDir, installDir, manifestData.name);

    // Make runner executable
    const runnerPath = path.join(installDir, manifestData.name);
    if (fs.existsSync(runnerPath)) {
      fs.chmodSync(runnerPath, 0o755);
    }

    // 5. Install native addons
    if (manifestData.dependencies.nativeAddons.length > 0) {
      console.log(`${c('cyan', '[install]')} installing native dependencies...`);
      await runCmd('npm', ['init', '-y', '--silent'], { cwd: installDir });
      await runCmd('npm', ['install', ...manifestData.dependencies.nativeAddons, '--save', '--silent'], {
        cwd: installDir,
      });
    }

    // 6. Set up SQLite data dir if needed
    if (manifestData.storage.type === 'sqlite') {
      const dataDir = path.join(os.homedir(), '.frontmcp', 'data', manifestData.name);
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // 7. Run setup questionnaire
    if (manifestData.setup?.steps && manifestData.setup.steps.length > 0) {
      console.log(`\n${c('bold', 'Setup Configuration')}`);
      const result = await runQuestionnaire(manifestData.setup.steps, {
        silent: opts.yes,
      });
      writeEnvFile(installDir, result.envContent);
      console.log(`${c('green', '[install]')} configuration saved to .env`);
    }

    // 8. Register in registry
    const port = opts.port || manifestData.network.defaultPort;
    registerApp(manifestData.name, {
      version: manifestData.version,
      installDir,
      installedAt: new Date().toISOString(),
      runner: path.join(installDir, manifestData.name),
      bundle: path.join(installDir, manifestData.bundle),
      storage: manifestData.storage.type,
      port,
      source: { type: source.type, ref: source.ref },
    });

    console.log(`\n${c('green', `Installed "${manifestData.name}" successfully.`)}`);
    console.log(`\n${c('bold', 'Start with:')}`);
    console.log(`  frontmcp start ${manifestData.name}`);
    console.log(`\n${c('bold', 'Reconfigure:')}`);
    console.log(`  frontmcp configure ${manifestData.name}`);
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

function findManifest(dir: string): { data: ExecManifest; dir: string } | null {
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir);
  const manifestFile = files.find((f: string) => f.endsWith('.manifest.json'));

  if (manifestFile) {
    const manifestPath = path.join(dir, manifestFile);
    const data = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ExecManifest;
    return { data, dir };
  }

  // Check dist/ subdirectory
  const distDir = path.join(dir, 'dist');
  if (fs.existsSync(distDir)) {
    return findManifest(distDir);
  }

  return null;
}

function copyIfExists(fromDir: string, toDir: string, filename: string): void {
  const src = path.join(fromDir, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(toDir, filename));
  }
}

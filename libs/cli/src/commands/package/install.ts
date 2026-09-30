/**
 * runInstall() orchestrator — installs an MCP app from npm, local, or git source.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { copyFile, ensureDir, realpath, runCmd, stat } from '@frontmcp/utils';

import { CONFIG_FILENAMES } from '../../config/frontmcp-config.loader';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { assertValidPluginName, isPluginContainedPath } from '../build/exec/cli-runtime/plugin-emitter';
import { type ExecManifest } from '../build/exec/manifest';
import { appDir, ensurePmDirs } from '../pm/paths';
import { runQuestionnaire, writeEnvFile } from './questionnaire';
import { registerApp } from './registry';
import { resolveRuntimePackageSpecs } from './runtime-packages';
import { fetchFromGit } from './sources/git';
import { fetchFromLocal } from './sources/local';
import { fetchFromNpm } from './sources/npm';
import { parseInstallSource } from './types';

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
      case 'esm':
        throw new Error(
          'ESM sources cannot be installed via "frontmcp install". ' +
            'Use loadFrom() in your FrontMcp config to load ESM packages at runtime.',
        );
    }

    // 2. Look for manifest
    let manifest = findManifest(packageDir);

    // 3. If no manifest, check for frontmcp.config.js and build
    if (!manifest) {
      const hasConfig = CONFIG_FILENAMES.some((f) => fs.existsSync(path.join(packageDir, f)));

      if (hasConfig) {
        console.log(`${c('cyan', '[install]')} no manifest found, building from config...`);
        if (
          fs.existsSync(path.join(packageDir, 'package.json')) &&
          !fs.existsSync(path.join(packageDir, 'node_modules'))
        ) {
          console.log(`${c('cyan', '[install]')} installing project dependencies...`);
          await runCmd('npm', ['install', '--silent'], { cwd: packageDir });
        }
        await runCmd('npx', ['frontmcp', 'build', '--target', 'node'], {
          cwd: packageDir,
        });
        manifest = findManifest(packageDir);
      }
    }

    if (!manifest) {
      throw new Error(
        'Could not find or generate a manifest. Ensure the package has a ' +
          'frontmcp.config.{ts,js,json,mjs,cjs} or was built with "frontmcp build --target node".',
      );
    }

    const { data: manifestData, dir: manifestDir } = manifest;

    assertValidPluginName(manifestData.name, 'frontmcp install');

    // 4. Install to ~/.frontmcp/apps/{name}/
    const installDir = appDir(manifestData.name);

    if (!isPluginContainedPath(installDir, manifestData.bundle)) {
      throw new Error(
        `Invalid manifest bundle "${String(manifestData.bundle)}": must be a relative path inside the app directory.`,
      );
    }

    ensurePmDirs();
    fs.mkdirSync(installDir, { recursive: true });

    console.log(`${c('cyan', '[install]')} installing "${manifestData.name}" to ${installDir}`);

    // Copy bundle + manifest + runner
    await copyIfExists(manifestDir, installDir, manifestData.bundle);
    await copyIfExists(manifestDir, installDir, `${manifestData.name}.manifest.json`);
    await copyIfExists(manifestDir, installDir, manifestData.name);

    // Make runner executable
    const runnerPath = path.join(installDir, manifestData.name);
    if (fs.existsSync(runnerPath)) {
      fs.chmodSync(runnerPath, 0o755);
    }

    // 5. Install runtime packages (externalized from the bundle) and native addons
    const packagesToInstall = [...resolveRuntimePackageSpecs(packageDir), ...manifestData.dependencies.nativeAddons];
    console.log(`${c('cyan', '[install]')} installing runtime dependencies...`);
    if (!fs.existsSync(path.join(installDir, 'package.json'))) {
      await runCmd('npm', ['init', '-y', '--silent'], { cwd: installDir });
    }
    await runCmd('npm', ['install', ...packagesToInstall, '--save', '--silent'], {
      cwd: installDir,
    });

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

    // 8. Register in registry. CLI builds omit the network section (they don't
    // bind a port), so fall back to undefined when --port wasn't passed.
    // Use `??` (not `||`) so an explicit `--port 0` overrides the manifest.
    const port = opts.port ?? manifestData.network?.defaultPort;
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

function readManifestIn(dir: string): { data: ExecManifest; dir: string } | null {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const manifestFile = files.find((f: string) => f.endsWith('.manifest.json'));
  if (!manifestFile) return null;
  const data = JSON.parse(fs.readFileSync(path.join(dir, manifestFile), 'utf-8')) as ExecManifest;
  return { data, dir };
}

/**
 * Find `<name>.manifest.json` in `dir`, `dir/dist`, or a per-target subdirectory of
 * `dir/dist` (`frontmcp build` writes to `dist/node`, `dist/cli`, ...).
 */
function findManifest(dir: string): { data: ExecManifest; dir: string } | null {
  if (!fs.existsSync(dir)) return null;

  const direct = readManifestIn(dir);
  if (direct) return direct;

  const distDir = path.join(dir, 'dist');
  if (!fs.existsSync(distDir)) return null;

  const inDist = readManifestIn(distDir);
  if (inDist) return inDist;

  for (const entry of fs.readdirSync(distDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = readManifestIn(path.join(distDir, entry.name));
    if (nested) return nested;
  }
  return null;
}

/**
 * Resolve `filename` inside `baseDir`, returning the real path only when it is a regular file
 * that stays within the directory. Both operands are resolved, so a symlink in the fetched
 * package cannot make the copy read a file elsewhere on the host, and a device or fifo cannot
 * make it read forever.
 */
async function resolveContainedFile(baseDir: string, filename: string): Promise<string | null> {
  try {
    const base = await realpath(baseDir);
    const resolved = await realpath(path.join(base, filename));

    if (!isPluginContainedPath(base, path.relative(base, resolved))) return null;

    return (await stat(resolved)).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

async function copyIfExists(fromDir: string, toDir: string, filename: string): Promise<void> {
  if (!isPluginContainedPath(toDir, filename)) return;

  const src = await resolveContainedFile(fromDir, filename);
  if (!src) return;

  const dest = path.join(toDir, filename);
  await ensureDir(path.dirname(dest));
  await copyFile(src, dest);
}

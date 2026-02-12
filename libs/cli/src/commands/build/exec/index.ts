/**
 * buildExec() orchestrator — produces a distributable bundle from a FrontMCP app.
 *
 * Output:
 *   dist/{name}.bundle.js       — esbuild single-file bundle
 *   dist/{name}.manifest.json   — app metadata (runtime reqs, setup questions)
 *   dist/{name}                 — bash runner script
 *   dist/install-{name}.sh      — bash installer script
 */

import * as path from 'path';
import * as fs from 'fs';
import { ParsedArgs } from '../../../args';
import { c } from '../../../colors';
import { resolveEntry } from '../../../utils/fs';
import { loadExecConfig, normalizeConfig } from './config';
import { bundleWithEsbuild, formatSize } from './esbuild-bundler';
import { generateManifest } from './manifest';
import { generateRunnerScript } from './runner-script';
import { generateInstallerScript } from './installer-script';
import { validateStepGraph } from './setup';
import { ensureDir, fileExists, runCmd } from '@frontmcp/utils';
import { REQUIRED_DECORATOR_FIELDS } from '../../../tsconfig';

export async function buildExec(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const outDir = path.resolve(cwd, opts.outDir || 'dist');

  console.log(`${c('cyan', '[build:exec]')} Building executable bundle...`);

  // 1. Load config
  const rawConfig = await loadExecConfig(cwd);
  const config = normalizeConfig(rawConfig);

  console.log(`${c('cyan', '[build:exec]')} name: ${config.name}`);
  console.log(`${c('cyan', '[build:exec]')} version: ${config.version}`);

  // 2. Resolve entry
  const entry = await resolveEntry(cwd, config.entry || opts.entry);
  console.log(`${c('cyan', '[build:exec]')} entry: ${path.relative(cwd, entry)}`);

  // 3. Validate setup graph if present
  if (config.setup?.steps) {
    console.log(
      `${c('cyan', '[build:exec]')} validating setup questionnaire (${config.setup.steps.length} steps)...`,
    );
    const errors = validateStepGraph(config.setup.steps);
    const realErrors = errors.filter((e) => !e.startsWith('Warning:'));
    const warnings = errors.filter((e) => e.startsWith('Warning:'));

    for (const w of warnings) {
      console.log(`${c('yellow', '[build:exec]')} ${w}`);
    }
    if (realErrors.length > 0) {
      for (const e of realErrors) {
        console.error(`${c('red', '[build:exec]')} ${e}`);
      }
      throw new Error('Setup questionnaire has validation errors. Fix them before building.');
    }
  }

  // 4. Compile TypeScript
  console.log(`${c('cyan', '[build:exec]')} compiling TypeScript...`);
  await ensureDir(outDir);

  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const hasTsconfig = await fileExists(tsconfigPath);
  const tscArgs: string[] = ['-y', 'tsc'];

  if (hasTsconfig) {
    tscArgs.push('--project', tsconfigPath);
  } else {
    tscArgs.push(entry);
    tscArgs.push('--rootDir', path.dirname(entry));
    tscArgs.push('--experimentalDecorators', '--emitDecoratorMetadata');
    tscArgs.push('--target', REQUIRED_DECORATOR_FIELDS.target);
  }

  tscArgs.push('--module', 'commonjs');
  tscArgs.push('--outDir', outDir);
  tscArgs.push('--skipLibCheck');

  await runCmd('npx', tscArgs);
  console.log(`${c('green', '[build:exec]')} TypeScript compiled.`);

  // 5. Bundle with esbuild
  console.log(`${c('cyan', '[build:exec]')} bundling with esbuild...`);
  const compiledEntry = path.join(
    outDir,
    path.basename(entry).replace(/\.tsx?$/, '.js'),
  );

  const bundleResult = await bundleWithEsbuild(compiledEntry, outDir, config);
  console.log(
    `${c('green', '[build:exec]')} bundle created: ${path.relative(cwd, bundleResult.bundlePath)} (${formatSize(bundleResult.bundleSize)})`,
  );

  // 6. Generate manifest
  const bundleFilename = `${config.name}.bundle.js`;
  const manifest = generateManifest(config, bundleFilename);
  const manifestPath = path.join(outDir, `${config.name}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(
    `${c('green', '[build:exec]')} manifest: ${path.relative(cwd, manifestPath)}`,
  );

  // 7. Generate runner script
  const runnerContent = generateRunnerScript(config);
  const runnerPath = path.join(outDir, config.name);
  fs.writeFileSync(runnerPath, runnerContent, { mode: 0o755 });
  console.log(
    `${c('green', '[build:exec]')} runner: ${path.relative(cwd, runnerPath)}`,
  );

  // 8. Generate installer script
  const installerContent = generateInstallerScript(config);
  const installerPath = path.join(outDir, `install-${config.name}.sh`);
  fs.writeFileSync(installerPath, installerContent, { mode: 0o755 });
  console.log(
    `${c('green', '[build:exec]')} installer: ${path.relative(cwd, installerPath)}`,
  );

  // 9. Clean up intermediate compiled files (keep only bundle + manifest + scripts)
  const keepFiles = new Set([
    `${config.name}.bundle.js`,
    `${config.name}.manifest.json`,
    config.name,
    `install-${config.name}.sh`,
  ]);

  const allFiles = fs.readdirSync(outDir);
  let cleaned = 0;
  for (const file of allFiles) {
    if (!keepFiles.has(file)) {
      const filePath = path.join(outDir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    }
  }
  if (cleaned > 0) {
    console.log(
      `${c('gray', '[build:exec]')} cleaned ${cleaned} intermediate file(s)`,
    );
  }

  console.log(`\n${c('green', 'Executable build completed.')}`);
  console.log(`\n${c('bold', 'Output:')}`);
  console.log(`  ${path.relative(cwd, bundleResult.bundlePath)}  ${c('gray', `(${formatSize(bundleResult.bundleSize)})`)}`);
  console.log(`  ${path.relative(cwd, manifestPath)}`);
  console.log(`  ${path.relative(cwd, runnerPath)}`);
  console.log(`  ${path.relative(cwd, installerPath)}`);
  console.log(`\n${c('gray', 'Run the server:')} ./${path.relative(cwd, runnerPath)}`);
  console.log(`${c('gray', 'Install to system:')} bash ./${path.relative(cwd, installerPath)}`);
}

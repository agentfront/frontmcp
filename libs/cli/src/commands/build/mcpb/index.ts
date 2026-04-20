/**
 * buildMcpb() — produce a `.mcpb` archive (MCP Bundle, spec v0.3).
 *
 * Pipeline:
 *   1. Load exec config, resolve entry, compile TypeScript (reuses exec).
 *   2. Bundle via esbuild (reuses exec's bundler).
 *   3. Extract tool/prompt/skill schema from the compiled bundle.
 *   4. Optionally build an SEA binary for the host platform.
 *   5. Stage the MCPB layout on disk (manifest + server/ + bin/ + icon + README).
 *   6. Deterministic zip → {outDir}/{name}-{version}.mcpb
 *   7. Clean up intermediates unless --stage-only.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ensureDir, fileExists, runCmd } from '@frontmcp/utils';
import type { ParsedArgs } from '../../../core/args';
import { c } from '../../../core/colors';
import { resolveEntry } from '../../../shared/fs';
import { REQUIRED_DECORATOR_FIELDS } from '../../../core/tsconfig';
import { findDeployment, type FrontMcpConfigParsed } from '../../../config';
import type { McpbDeployment } from '../../../config/frontmcp-config.types';
import { loadExecConfig, normalizeConfig } from '../exec/config';
import { bundleWithEsbuild, formatSize } from '../exec/esbuild-bundler';
import { buildPlatformOverrides, mergeBinariesFrom, resolveHostPlatform, binaryFileName, type BinaryEntry } from './binary';
import { generateMcpbManifest, resolveIconPath } from './manifest';
import { setupStepsToUserConfig } from './user-config';
import { stageMcpbDirectory, writeManifest } from './stage';
import { createDeterministicZip } from './zip';
import { ARCHIVE_SIZE_ERROR, ARCHIVE_SIZE_WARN } from './constants';
import { getSelfVersion } from '../../../core/version';

export interface BuildMcpbOptions extends ParsedArgs {
  /** Resolved MCPB deployment config (from frontmcp.config if present). */
  mcpbDeployment?: McpbDeployment;
}

export async function buildMcpb(
  opts: BuildMcpbOptions,
  configParsed?: FrontMcpConfigParsed,
): Promise<void> {
  const cwd = process.cwd();
  const outDir = path.resolve(cwd, opts.outDir || 'dist');

  console.log(`${c('cyan', '[build:mcpb]')} Building MCP Bundle...`);

  // 1. Resolve exec + mcpb config
  const rawConfig = await loadExecConfig(cwd);
  const execConfig = normalizeConfig(rawConfig);

  // When a v1 frontmcp.config is present, its build.esbuild / build.dependencies
  // win — the legacy loader returns the raw file without merging these.
  if (configParsed?.build?.esbuild) {
    execConfig.esbuild = {
      ...(execConfig.esbuild ?? {}),
      ...configParsed.build.esbuild,
    };
  }
  if (configParsed?.build?.dependencies?.nativeAddons) {
    execConfig.dependencies = {
      ...(execConfig.dependencies ?? {}),
      nativeAddons: [
        ...(execConfig.dependencies?.nativeAddons ?? []),
        ...configParsed.build.dependencies.nativeAddons,
      ],
    };
  }
  if (configParsed?.nodeVersion) {
    execConfig.nodeVersion = configParsed.nodeVersion;
  }

  const mcpbDeployment =
    opts.mcpbDeployment
    ?? (configParsed ? (findDeployment(configParsed, 'mcpb') as McpbDeployment | undefined) : undefined);

  console.log(`${c('cyan', '[build:mcpb]')} name: ${execConfig.name}`);
  console.log(`${c('cyan', '[build:mcpb]')} version: ${execConfig.version}`);

  // 2. Resolve entry
  const entry = await resolveEntry(cwd, execConfig.entry || opts.entry);
  console.log(`${c('cyan', '[build:mcpb]')} entry: ${path.relative(cwd, entry)}`);

  // 3. TypeScript compile (same as exec pipeline)
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
  tscArgs.push('--module', 'commonjs', '--outDir', outDir, '--skipLibCheck');
  await runCmd('npx', tscArgs);
  console.log(`${c('green', '[build:mcpb]')} TypeScript compiled`);

  // 4. esbuild bundle → dist/{name}.bundle.js
  const compiledEntry = path.join(outDir, path.basename(entry).replace(/\.tsx?$/, '.js'));
  const bundleResult = await bundleWithEsbuild(compiledEntry, outDir, execConfig);
  console.log(
    `${c('green', '[build:mcpb]')} bundle: ${path.relative(cwd, bundleResult.bundlePath)} (${formatSize(bundleResult.bundleSize)})`,
  );

  // 5. Schema extraction
  const { extractSchemas, SYSTEM_TOOL_NAMES } = await import('../exec/cli-runtime/schema-extractor.js');
  const schema = await extractSchemas(bundleResult.bundlePath);
  const userToolCount = schema.tools.filter((t) => !SYSTEM_TOOL_NAMES.has(t.name)).length;
  console.log(
    `${c('cyan', '[build:mcpb]')} extracted: ${userToolCount} tools, ${schema.resources.length} resources, ${schema.prompts.length} prompts`,
  );

  // 6. SEA binaries (optional)
  const seaRequested = !!(opts.sea || mcpbDeployment?.sea?.enabled);
  const mergeFrom = opts.mergeFrom ?? mcpbDeployment?.sea?.mergeFrom;
  const binaries: BinaryEntry[] = [];

  if (seaRequested) {
    const hostPlatform = resolveHostPlatform();
    if (!hostPlatform) {
      console.log(
        `${c('yellow', '[build:mcpb]')} Unknown host platform ${process.platform}-${process.arch}; skipping SEA build`,
      );
    } else {
      console.log(`${c('cyan', '[build:mcpb]')} building SEA binary for ${hostPlatform}...`);
      const seaBundleName = `${execConfig.name}.sea-temp`;
      const seaBundle = await bundleWithEsbuild(compiledEntry, outDir, execConfig, {
        selfContained: true,
        outputName: seaBundleName,
      });
      const { buildSea } = await import('../exec/sea-builder.js');
      const seaResult = await buildSea(seaBundle.bundlePath, outDir, execConfig.name);
      fs.unlinkSync(seaBundle.bundlePath);
      binaries.push({
        platform: hostPlatform,
        srcPath: seaResult.executablePath,
        fileName: binaryFileName(execConfig.name, hostPlatform),
      });
      console.log(
        `${c('green', '[build:mcpb]')} SEA binary: ${path.relative(cwd, seaResult.executablePath)} (${formatSize(seaResult.executableSize)})`,
      );
    }
  }

  if (mergeFrom) {
    const absMergeDir = path.isAbsolute(mergeFrom) ? mergeFrom : path.resolve(cwd, mergeFrom);
    const merged = mergeBinariesFrom(absMergeDir, execConfig.name);
    if (merged.length === 0) {
      console.log(`${c('yellow', '[build:mcpb]')} mergeFrom "${absMergeDir}" produced no binaries`);
    } else {
      console.log(
        `${c('cyan', '[build:mcpb]')} merging ${merged.length} cross-platform binaries from ${path.relative(cwd, absMergeDir)}`,
      );
      // Replace any duplicate platform entries from the local SEA build with merge-from versions.
      for (const bin of merged) {
        const idx = binaries.findIndex((b) => b.platform === bin.platform);
        if (idx >= 0) binaries.splice(idx, 1);
        binaries.push(bin);
      }
    }
  }

  // 7. Translate setup steps → user_config + env
  const { userConfig, env: userConfigEnv, warnings } = setupStepsToUserConfig(
    execConfig.setup?.steps,
    mcpbDeployment,
  );
  for (const w of warnings) {
    console.log(`${c('yellow', '[build:mcpb]')} ${w}`);
  }

  // 8. Stage — outDir is already {dist}/mcpb (set by buildSingleTarget per-target layout)
  const stageDir = path.join(outDir, '__stage');
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
  const iconOverride = opts.icon ?? mcpbDeployment?.icon;
  const iconAbs = resolveIconPath(cwd, iconOverride);
  const iconAbsPath = iconAbs ? path.resolve(cwd, iconAbs) : undefined;

  const stageResult = stageMcpbDirectory({
    stageDir,
    cwd,
    serverBundlePath: bundleResult.bundlePath,
    name: execConfig.name,
    version: execConfig.version,
    schema,
    iconPath: iconAbsPath,
    binaries,
  });
  if (stageResult.skillAssetCount > 0) {
    console.log(`${c('green', '[build:mcpb]')} copied ${stageResult.skillAssetCount} skill asset(s) to server/_skills/`);
  }
  if (stageResult.hasIcon) {
    console.log(`${c('green', '[build:mcpb]')} icon: ${iconAbs}`);
  }

  // 9. Manifest
  const platformOverrides = buildPlatformOverrides(binaries);
  const manifest = generateMcpbManifest({
    name: execConfig.name,
    version: execConfig.version,
    nodeVersion: execConfig.nodeVersion,
    cwd,
    deployment: mcpbDeployment,
    schema,
    userConfig,
    userConfigEnv,
    platformOverrides,
    hasIcon: stageResult.hasIcon,
    cliVersion: getSelfVersion(),
  });
  writeManifest(stageDir, manifest);
  console.log(`${c('green', '[build:mcpb]')} wrote manifest.json`);

  // 10. Zip (unless --stage-only)
  if (opts.stageOnly) {
    console.log(`${c('yellow', '[build:mcpb]')} --stage-only set; leaving ${path.relative(cwd, stageDir)} for inspection`);
    cleanupIntermediates(outDir, ['__stage']);
    return;
  }

  const archivePath = path.join(outDir, `${execConfig.name}-${execConfig.version}.mcpb`);
  const zipResult = await createDeterministicZip(stageDir, archivePath, {
    deterministic: !opts.noDeterministic && (mcpbDeployment?.deterministic ?? true),
  });
  console.log(
    `${c('green', '[build:mcpb]')} ${path.relative(cwd, zipResult.archivePath)} (${formatSize(zipResult.size)})`,
  );
  console.log(`${c('gray', '[build:mcpb]')} sha256: ${zipResult.sha256}`);

  if (zipResult.size > ARCHIVE_SIZE_ERROR) {
    console.log(
      `${c('yellow', '[build:mcpb]')} Archive is ${(zipResult.size / 1024 / 1024).toFixed(1)} MB — consider tuning externals`,
    );
  } else if (zipResult.size > ARCHIVE_SIZE_WARN) {
    console.log(`${c('yellow', '[build:mcpb]')} Archive is ${(zipResult.size / 1024 / 1024).toFixed(1)} MB`);
  }

  // 11. Cleanup
  fs.rmSync(stageDir, { recursive: true, force: true });
  cleanupIntermediates(outDir, [`${execConfig.name}-${execConfig.version}.mcpb`]);

  console.log(`\n${c('green', 'MCPB build completed.')}`);
  console.log(`${c('gray', 'Install:')} open ${path.relative(cwd, zipResult.archivePath)}`);
}

/**
 * Remove files/dirs in outDir that aren't in the keep-list.
 *
 * The tsc + esbuild stages write intermediates directly into outDir (same
 * pattern as the exec target uses). We keep the archive and — in stage-only
 * mode — the `__stage/` directory so the user can inspect it.
 */
function cleanupIntermediates(outDir: string, keep: string[]): void {
  if (!fs.existsSync(outDir)) return;
  const keepSet = new Set(keep);
  for (const entry of fs.readdirSync(outDir)) {
    if (keepSet.has(entry)) continue;
    const full = path.join(outDir, entry);
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      // best-effort — a race with an external process shouldn't fail the build
    }
  }
}

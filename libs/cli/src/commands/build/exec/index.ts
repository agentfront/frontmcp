/**
 * buildExec() orchestrator — produces a distributable bundle from a FrontMCP app.
 *
 * Output (server-only mode):
 *   dist/{name}.bundle.js       — esbuild single-file bundle
 *   dist/{name}.manifest.json   — app metadata (runtime reqs, setup questions)
 *   dist/{name}                 — bash runner script
 *   dist/install-{name}.sh      — bash installer script
 *
 * Output (CLI mode, --cli flag):
 *   All of the above, plus:
 *   dist/{name}-cli.bundle.js   — CLI executable bundle (commander.js)
 *   dist/{name}                 — bash runner dispatches to CLI bundle
 */

import * as path from 'path';
import * as fs from 'fs';
import { type ParsedArgs } from '../../../core/args';
import { c } from '../../../core/colors';
import { resolveEntry } from '../../../shared/fs';
import { loadExecConfig, normalizeConfig } from './config';
import { bundleWithEsbuild, formatSize } from './esbuild-bundler';
import { generateManifest } from './manifest';
import { generateRunnerScript } from './runner-script';
import { generateInstallerScript } from './installer-script';
import { validateStepGraph } from './setup';
import { ensureDir, fileExists, runCmd } from '@frontmcp/utils';
import { REQUIRED_DECORATOR_FIELDS } from '../../../core/tsconfig';

export async function buildExec(
  opts: ParsedArgs & {
    cli?: boolean;
    sea?: boolean;
    execOverrides?: {
      storage?: { type: 'sqlite' | 'redis' | 'none'; required?: boolean };
      cli?: { outputDefault?: 'text' | 'json'; description?: string; authRequired?: boolean };
    };
  },
): Promise<void> {
  const cwd = process.cwd();
  const outDir = path.resolve(cwd, opts.outDir || 'dist');

  console.log(`${c('cyan', '[build:exec]')} Building executable bundle...`);

  // 1. Load config (and merge in overrides forwarded from frontmcp.config —
  //    `build.storage`, `deployments[].cli.outputDefault`, etc.)
  const rawConfig = await loadExecConfig(cwd);
  if (opts.execOverrides) {
    if (opts.execOverrides.storage && !rawConfig.storage) {
      rawConfig.storage = opts.execOverrides.storage;
    }
    if (opts.execOverrides.cli) {
      const existing = rawConfig.cli;
      // CliConfig requires `enabled: boolean`; preserve any existing value or
      // default to true (we only get here when CLI mode is being configured).
      rawConfig.cli = {
        enabled: existing?.enabled ?? true,
        ...existing,
        ...opts.execOverrides.cli,
      };
    }
  }
  const config = normalizeConfig(rawConfig);
  const cliEnabled = opts.cli || config.cli?.enabled;
  const seaEnabled = opts.sea || config.sea?.enabled;

  console.log(`${c('cyan', '[build:exec]')} name: ${config.name}`);
  console.log(`${c('cyan', '[build:exec]')} version: ${config.version}`);
  if (cliEnabled) {
    console.log(`${c('cyan', '[build:exec]')} CLI mode: enabled`);
  }
  if (seaEnabled) {
    console.log(`${c('cyan', '[build:exec]')} SEA mode: enabled (single executable)`);
  }

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

  // Always build non-self-contained first (schema extraction needs host SDK)
  const bundleResult = await bundleWithEsbuild(compiledEntry, outDir, config);
  console.log(
    `${c('green', '[build:exec]')} bundle created: ${path.relative(cwd, bundleResult.bundlePath)} (${formatSize(bundleResult.bundleSize)})`,
  );

  // 6. Extract schema once and reuse for both the manifest port resolution
  //    (#371) and the CLI command generation (when cliEnabled). Schema
  //    extraction loads the user's bundle and boots an in-memory client
  //    (~200ms); running it twice on every --target cli build added up.
  const bundleFilename = `${config.name}.bundle.js`;
  const { extractSchemas } = await import('./cli-runtime/schema-extractor.js');
  let extractedSchema: Awaited<ReturnType<typeof extractSchemas>> | undefined;
  try {
    extractedSchema = await extractSchemas(bundleResult.bundlePath);
  } catch (err) {
    if (cliEnabled) {
      // CLI builds genuinely need the schema — fail loud.
      throw err;
    }
    // For --target node we only need httpPort from the schema; falling back
    // to the manifest's default precedence chain is acceptable.
  }

  // 7. Generate manifest with extracted decorator port + per-deployment cli config
  const manifest = generateManifest(config, bundleFilename, {
    target: cliEnabled ? 'cli' : 'node',
    decoratorHttpPort: extractedSchema?.httpPort,
    outputDefault: config.cli?.outputDefault as 'text' | 'json' | undefined,
  });

  // 7. CLI build step (if enabled)
  let cliBundlePath: string | undefined;
  if (cliEnabled) {
    console.log(`${c('cyan', '[build:exec]')} extracting schemas for CLI...`);

    const { SYSTEM_TOOL_NAMES } = await import('./cli-runtime/schema-extractor.js');
    const { generateCliEntry, resolveToolCommandName } = await import('./cli-runtime/generate-cli-entry.js');
    const { generateOutputFormatterSource } = await import('./cli-runtime/output-formatter.js');
    const { generateSessionManagerSource } = await import('./cli-runtime/session-manager.js');
    const { generateCredentialStoreSource } = await import('./cli-runtime/credential-store.js');
    const { generateOAuthHelperSource } = await import('./cli-runtime/oauth-helper.js');
    const { generateDaemonClientSource } = await import('./cli-runtime/daemon-client.js');
    const { bundleCliWithEsbuild } = await import('./cli-runtime/cli-bundler.js');

    // Reuse the schema extracted in step 6 (single extraction per build).
    // The non-null assertion is safe — we threw above if cliEnabled and
    // extraction failed, so by here `extractedSchema` is always defined.
    const schema = extractedSchema!;

    const capabilities = schema.capabilities;
    const userToolCount = schema.tools.filter(
      (t) => !SYSTEM_TOOL_NAMES.has(t.name),
    ).length;

    console.log(
      `${c('cyan', '[build:exec]')} extracted: ${schema.tools.length} tools (${userToolCount} user), ${schema.resources.length} resources, ${schema.resourceTemplates.length} templates, ${schema.prompts.length} prompts`,
    );
    if (capabilities.skills) console.log(`${c('cyan', '[build:exec]')} capability: skills`);
    if (capabilities.jobs) console.log(`${c('cyan', '[build:exec]')} capability: jobs`);
    if (capabilities.workflows) console.log(`${c('cyan', '[build:exec]')} capability: workflows`);

    // Copy skill content files via shared helper (flat _skills/ layout).
    const { copySkillAssets } = await import('./skill-assets.js');
    const { copiedCount } = copySkillAssets(outDir, schema.skillAssets);
    if (copiedCount > 0) {
      console.log(`${c('green', '[build:exec]')} copied ${copiedCount} skill content file(s) to _skills/`);
    }

    // Log tool name conflicts
    const cliConfig = config.cli || { enabled: true };
    const excludeTools = cliConfig.excludeTools || [];
    schema.tools
      .filter((t) => !excludeTools.includes(t.name))
      .forEach((t) => {
        const { wasRenamed, cmdName } = resolveToolCommandName(t.name);
        if (wasRenamed) {
          console.log(
            `${c('yellow', '[build:exec]')} Tool "${t.name}" conflicts with built-in command, mapped to "${cmdName}"`,
          );
        }
      });

    // Generate runtime modules
    const outputDefault = cliConfig.outputDefault || 'text';
    const authRequired = cliConfig.authRequired ?? false;
    const nativeDeps = cliConfig.nativeDeps || {};
    const oauthConfig = cliConfig.oauth;

    // Write runtime modules to temp files for bundling
    const tempDir = path.join(outDir, '__cli_temp');
    fs.mkdirSync(tempDir, { recursive: true });

    fs.writeFileSync(
      path.join(tempDir, 'output-formatter.js'),
      generateOutputFormatterSource(),
    );
    fs.writeFileSync(
      path.join(tempDir, 'session-manager.js'),
      generateSessionManagerSource(config.name),
    );
    fs.writeFileSync(
      path.join(tempDir, 'credential-store.js'),
      generateCredentialStoreSource(config.name),
    );
    fs.writeFileSync(
      path.join(tempDir, 'oauth-helper.js'),
      generateOAuthHelperSource(config.name),
    );
    fs.writeFileSync(
      path.join(tempDir, 'daemon-client.js'),
      generateDaemonClientSource(),
    );

    // Generate CLI entry
    const cliEntrySource = generateCliEntry({
      appName: config.name,
      appVersion: config.version || '1.0.0',
      description: cliConfig.description || `${config.name} CLI`,
      serverBundleFilename: bundleFilename,
      outputDefault,
      authRequired,
      excludeTools,
      nativeDeps,
      schema,
      oauthConfig,
      selfContained: !!seaEnabled,
    });

    const cliEntryPath = path.join(tempDir, 'cli-entry.js');
    fs.writeFileSync(cliEntryPath, cliEntrySource);

    // Bundle CLI
    console.log(`${c('cyan', '[build:exec]')} bundling CLI...`);
    const cliResult = await bundleCliWithEsbuild(cliEntryPath, outDir, config, {
      selfContained: !!seaEnabled,
    });
    cliBundlePath = cliResult.bundlePath;
    console.log(
      `${c('green', '[build:exec]')} CLI bundle: ${path.relative(cwd, cliResult.bundlePath)} (${formatSize(cliResult.bundleSize)})`,
    );

    // Clean temp
    fs.rmSync(tempDir, { recursive: true, force: true });

    // Extend manifest with CLI metadata
    manifest.cli = {
      enabled: true,
      cliBundle: `${config.name}-cli.bundle.js`,
      outputDefault,
      authRequired,
      toolCount: userToolCount,
      resourceCount: schema.resources.length,
      templateCount: schema.resourceTemplates.length,
      promptCount: schema.prompts.length,
      oauthEnabled: !!oauthConfig,
      skillsEnabled: capabilities.skills || undefined,
      jobsEnabled: capabilities.jobs || undefined,
      workflowsEnabled: capabilities.workflows || undefined,
    };
  }

  // 8. Build SEA binaries if enabled
  //
  // For --target cli (cliEnabled === true), the runner script `exec`s only
  // the CLI binary — the standalone server SEA is dead weight (~114 MB, see
  // issue #373). Skip the server-SEA pass entirely in that mode. For
  // --target node (cliEnabled === false), build only the server SEA.
  let seaServerResult: { executablePath: string; executableSize: number } | undefined;
  let seaCliResult: { executablePath: string; executableSize: number } | undefined;
  if (seaEnabled) {
    const { buildSea } = await import('./sea-builder.js');

    if (!cliEnabled) {
      // Server-only SEA path (--target node): rebuild bundle as self-contained
      // (inlines all deps) and produce ${name}-bin.
      const seaTempName = `${config.name}.sea-temp`;
      console.log(`${c('cyan', '[build:sea]')} rebuilding server bundle (self-contained)...`);
      const seaBundle = await bundleWithEsbuild(compiledEntry, outDir, config, {
        selfContained: true,
        outputName: seaTempName,
      });

      console.log(`${c('cyan', '[build:sea]')} building server SEA binary...`);
      seaServerResult = await buildSea(seaBundle.bundlePath, outDir, config.name);
      fs.unlinkSync(seaBundle.bundlePath);
      console.log(
        `${c('green', '[build:sea]')} server binary: ${path.relative(cwd, seaServerResult.executablePath)} (${formatSize(seaServerResult.executableSize)})`,
      );
    }

    if (cliBundlePath) {
      console.log(`${c('cyan', '[build:sea]')} building CLI SEA binary...`);
      seaCliResult = await buildSea(cliBundlePath, outDir, `${config.name}-cli`);
      console.log(
        `${c('green', '[build:sea]')} CLI binary: ${path.relative(cwd, seaCliResult.executablePath)} (${formatSize(seaCliResult.executableSize)})`,
      );
    }
  }

  // 9. Write manifest
  const manifestPath = path.join(outDir, `${config.name}.manifest.json`);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(
    `${c('green', '[build:exec]')} manifest: ${path.relative(cwd, manifestPath)}`,
  );

  // 10. Generate runner script (dispatches to CLI bundle or SEA binary)
  const runnerContent = generateRunnerScript(config, !!cliEnabled, !!seaEnabled);
  const runnerPath = path.join(outDir, config.name);
  fs.writeFileSync(runnerPath, runnerContent, { mode: 0o755 });
  console.log(
    `${c('green', '[build:exec]')} runner: ${path.relative(cwd, runnerPath)}`,
  );

  // 10. Generate installer script
  const installerContent = generateInstallerScript(config, {
    target: cliEnabled ? 'cli' : 'node',
    seaEnabled: !!seaEnabled,
  });
  const installerPath = path.join(outDir, `install-${config.name}.sh`);
  fs.writeFileSync(installerPath, installerContent, { mode: 0o755 });
  console.log(
    `${c('green', '[build:exec]')} installer: ${path.relative(cwd, installerPath)}`,
  );

  // 12. Clean up intermediate compiled files
  const keepFiles = new Set([
    `${config.name}.bundle.js`,
    `${config.name}-cli.bundle.js`,
    `${config.name}.manifest.json`,
    config.name,
    `install-${config.name}.sh`,
    `${config.name}-bin`,
    `${config.name}-cli-bin`,
    '_skills',
  ]);

  const allFiles = fs.readdirSync(outDir);
  let cleaned = 0;
  for (const file of allFiles) {
    if (!keepFiles.has(file)) {
      const filePath = path.join(outDir, file);
      const stat = fs.statSync(filePath);
      // Only clean intermediate compiled files; preserve .md and _skills/ directory
      if (stat.isFile() && !file.endsWith('.md')) {
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

  // 13. Print summary
  console.log(`\n${c('green', 'Executable build completed.')}`);
  console.log(`\n${c('bold', 'Output:')}`);
  console.log(`  ${path.relative(cwd, bundleResult.bundlePath)}  ${c('gray', `(${formatSize(bundleResult.bundleSize)})`)}`);
  if (cliBundlePath) {
    const cliStat = fs.statSync(cliBundlePath);
    console.log(`  ${path.relative(cwd, cliBundlePath)}  ${c('gray', `(${formatSize(cliStat.size)})`)}`);
  }
  if (seaServerResult) {
    console.log(`  ${path.relative(cwd, seaServerResult.executablePath)}  ${c('gray', `(${formatSize(seaServerResult.executableSize)})`)}`);
  }
  if (seaCliResult) {
    console.log(`  ${path.relative(cwd, seaCliResult.executablePath)}  ${c('gray', `(${formatSize(seaCliResult.executableSize)})`)}`);
  }
  console.log(`  ${path.relative(cwd, manifestPath)}`);
  console.log(`  ${path.relative(cwd, runnerPath)}`);
  console.log(`  ${path.relative(cwd, installerPath)}`);

  if (cliEnabled) {
    console.log(`\n${c('gray', 'Run the CLI:')} ./${path.relative(cwd, runnerPath)} --help`);
    console.log(`${c('gray', 'Start server:')} ./${path.relative(cwd, runnerPath)} serve`);
  } else {
    console.log(`\n${c('gray', 'Run the server:')} ./${path.relative(cwd, runnerPath)}`);
  }
  if (seaServerResult || seaCliResult) {
    console.log(`\n${c('yellow', 'Note:')} SEA binaries are native executables. Run directly (not via bash).`);
  }
  console.log(`${c('gray', 'Install to system:')} bash ./${path.relative(cwd, installerPath)}`);
}

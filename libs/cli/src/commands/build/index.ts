import * as path from 'path';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { ensureDir, fileExists, runCmd, writeJSON } from '@frontmcp/utils';
import { fsp, resolveEntry } from '../../shared/fs';
import { REQUIRED_DECORATOR_FIELDS } from '../../core/tsconfig';
import { ADAPTERS } from './adapters';
import { type AdapterName } from './types';
import { bundleForServerless } from './bundler';
import { findDeployment, type FrontMcpConfigParsed, getDeploymentTargets, loadFrontMcpConfig } from '../../config';

function isTsLike(p: string): boolean {
  return /\.tsx?$/i.test(p);
}

/**
 * Generate adapter-specific entry point and config files.
 */
async function generateAdapterFiles(
  adapter: AdapterName,
  outDir: string,
  entryBasename: string,
  cwd: string,
): Promise<void> {
  const template = ADAPTERS[adapter];

  // Generate serverless setup file first (if adapter has one)
  // This file sets FRONTMCP_SERVERLESS=1 before any imports run
  if (template.getSetupTemplate) {
    const setupContent = template.getSetupTemplate();
    const setupPath = path.join(outDir, 'serverless-setup.js');
    await fsp.writeFile(setupPath, setupContent, 'utf8');
    console.log(c('green', `  Generated serverless setup at ${path.relative(cwd, setupPath)}`));
  }

  // Generate index.js entry point
  const mainModuleName = entryBasename.replace(/\.tsx?$/, '.js');
  const entryContent = template.getEntryTemplate(`./${mainModuleName}`);

  // Skip if no entry template (e.g., node adapter)
  if (entryContent) {
    const entryPath = path.join(outDir, 'index.js');
    await fsp.writeFile(entryPath, entryContent, 'utf8');
    console.log(c('green', `  Generated ${adapter} entry at ${path.relative(cwd, entryPath)}`));
  }

  // Bundle if adapter requires it (creates single CJS file for serverless)
  if (template.shouldBundle && template.bundleOutput) {
    console.log(c('cyan', `[build] Bundling for ${adapter}...`));
    const entryPath = path.join(outDir, 'index.js');
    await bundleForServerless(entryPath, outDir, template.bundleOutput);
    console.log(c('green', `  Created bundle: ${template.bundleOutput}`));

    // Run post-bundle hook if defined (e.g., create Build Output API structure)
    if (template.postBundle) {
      console.log(c('cyan', `[build] Creating ${adapter} deployment structure...`));
      await template.postBundle(outDir, cwd, template.bundleOutput);
      console.log(c('green', `  Created deployment output structure`));
    }
  }

  // Generate config file if adapter has one (skip if already exists)
  if (template.getConfig && template.configFileName) {
    const configPath = path.join(cwd, template.configFileName);

    if (await fileExists(configPath)) {
      console.log(c('yellow', `  ${template.configFileName} already exists (skipping)`));
    } else {
      const configContent = template.getConfig(cwd);

      if (typeof configContent === 'string') {
        // Write as plain text (e.g., TOML for wrangler.toml)
        await fsp.writeFile(configPath, configContent, 'utf8');
      } else {
        // Write as JSON
        await writeJSON(configPath, configContent);
      }
      console.log(c('green', `  Generated ${template.configFileName}`));
    }
  }
}

/** Map target names to internal adapter names. */
const TARGET_TO_ADAPTER: Record<string, AdapterName> = {
  'vercel': 'vercel',
  'lambda': 'lambda',
  'cloudflare': 'cloudflare',
  'distributed': 'distributed',
};

/**
 * Build the FrontMCP server for a specific deployment target.
 *
 * @example
 * ```bash
 * frontmcp build --target node          # Node.js server bundle
 * frontmcp build --target cli           # CLI with SEA binary
 * frontmcp build --target cli --js      # CLI without SEA
 * frontmcp build --target sdk           # Library (CJS+ESM+types)
 * frontmcp build --target browser       # Browser ESM bundle
 * frontmcp build --target vercel        # Vercel serverless
 * frontmcp build --target lambda        # AWS Lambda
 * frontmcp build --target cloudflare    # Cloudflare Workers
 * ```
 */
export async function runBuild(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();

  // Try loading frontmcp.config for multi-target support
  let config: FrontMcpConfigParsed | undefined;
  try {
    config = await loadFrontMcpConfig(cwd);
  } catch {
    // No config file — fall back to CLI flags only
  }

  // If no -t flag and config has deployments, build all targets from config
  if (!opts.buildTarget && config && config.deployments.length > 0) {
    const targets = getDeploymentTargets(config);
    console.log(c('cyan', `[build] Building ${targets.length} target(s) from frontmcp.config: ${targets.join(', ')}`));

    for (const targetName of targets) {
      console.log(c('cyan', `\n[build] ═══ ${targetName} ═══`));
      await buildSingleTarget(targetName, opts, config);
    }
    return;
  }

  // Single target build (from -t flag or default 'node')
  const target = opts.buildTarget ?? 'node';
  await buildSingleTarget(target, opts, config);
}

/**
 * Build a single deployment target.
 * Merges per-target config (from frontmcp.config) with CLI opts.
 */
async function buildSingleTarget(
  target: string,
  opts: ParsedArgs,
  config?: FrontMcpConfigParsed,
): Promise<void> {
  const deployment = config ? findDeployment(config, target) : undefined;

  // Resolve output directory: deployment.outDir > CLI --out-dir > dist/{target}
  const baseOutDir = path.resolve(process.cwd(), opts.outDir || 'dist');
  const targetOutDir = deployment?.outDir
    ? path.resolve(process.cwd(), deployment.outDir)
    : path.join(baseOutDir, target);

  // Merge entry from config if not provided via CLI
  const entry = opts.entry || config?.entry;
  const targetOpts = { ...opts, outDir: targetOutDir, entry };

  switch (target) {
    case 'cli': {
      const { buildExec } = await import('./exec/index.js');
      return buildExec({ ...targetOpts, cli: true, sea: !opts.js } as ParsedArgs & { cli: boolean; sea: boolean });
    }
    case 'node': {
      const { buildExec } = await import('./exec/index.js');
      return buildExec(targetOpts);
    }
    case 'sdk': {
      const { buildSdk } = await import('./sdk/index.js');
      return buildSdk(targetOpts);
    }
    case 'browser': {
      const { buildBrowser } = await import('./browser/index.js');
      return buildBrowser(targetOpts);
    }
    case 'vercel':
    case 'lambda':
    case 'cloudflare':
    case 'distributed': {
      const adapter = TARGET_TO_ADAPTER[target];
      return runAdapterBuild(targetOpts, adapter);
    }
    default:
      throw new Error(`Unknown build target: ${target}. Available: cli, node, sdk, browser, cloudflare, vercel, lambda, distributed`);
  }
}

/**
 * Build using a deployment adapter (serverless platforms).
 */
async function runAdapterBuild(opts: ParsedArgs, adapter: AdapterName): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const outDir = path.resolve(cwd, opts.outDir || 'dist');
  await ensureDir(outDir);

  const template = ADAPTERS[adapter];
  if (!template) {
    const available = Object.keys(ADAPTERS).join(', ');
    throw new Error(`Unknown adapter: ${adapter}. Available: ${available}`);
  }

  if (adapter === 'cloudflare') {
    console.log(
      c('yellow', 'Cloudflare Workers adapter is experimental. See docs for limitations.'),
    );
  }

  const moduleFormat = template.moduleFormat;

  console.log(`${c('cyan', '[build]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[build]')} outDir: ${path.relative(cwd, outDir)}`);
  console.log(`${c('cyan', '[build]')} target: ${adapter} (${moduleFormat})`);

  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const hasTsconfig = await fileExists(tsconfigPath);
  const args: string[] = ['-y', 'tsc'];

  if (hasTsconfig) {
    console.log(c('gray', `[build] tsconfig.json detected — compiling with project settings`));
    args.push('--project', tsconfigPath);
  } else {
    args.push(entry);
    args.push('--rootDir', path.dirname(entry));
    if (!isTsLike(entry)) {
      args.push('--allowJs');
      console.log(c('yellow', '[build] Entry is not TypeScript; enabling --allowJs'));
    }
    args.push('--experimentalDecorators', '--emitDecoratorMetadata');
    args.push('--target', REQUIRED_DECORATOR_FIELDS.target);
  }

  args.push('--module', moduleFormat);
  args.push('--outDir', outDir);
  args.push('--skipLibCheck');

  await runCmd('npx', args);

  if (adapter !== 'node') {
    console.log(c('cyan', `[build] Generating ${adapter} deployment files...`));
    const entryBasename = path.basename(entry);
    await generateAdapterFiles(adapter, outDir, entryBasename, cwd);
  }

  console.log(c('green', 'Build completed.'));
  console.log(c('gray', `Output placed in ${path.relative(cwd, outDir)}`));
}

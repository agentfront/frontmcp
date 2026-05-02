import * as path from 'path';
import { type ParsedArgs } from '../../core/args';
import { c } from '../../core/colors';
import { ensureDir, fileExists, runCmd, writeJSON } from '@frontmcp/utils';
import { fsp, resolveEntry } from '../../shared/fs';
import { REQUIRED_DECORATOR_FIELDS } from '../../core/tsconfig';
import { ADAPTERS } from './adapters';
import { type AdapterName } from './types';
import { bundleForServerless } from './bundler';
import { type DeploymentTarget, findDeployment, type FrontMcpConfigParsed, getDeploymentTargets, loadFrontMcpConfig } from '../../config';

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

    // ESM adapters (vercel, lambda) emit `import` syntax in the entry. The
    // user's project may be `"type": "commonjs"`, in which case Node and
    // rspack treat the .js file as CJS and parsing fails on `import`.
    // Drop a sibling package.json with `"type": "module"` so the dist
    // directory is always interpreted correctly regardless of the parent.
    if (template.moduleFormat === 'esnext') {
      const pkgPath = path.join(outDir, 'package.json');
      await fsp.writeFile(pkgPath, JSON.stringify({ type: 'module' }, null, 2), 'utf8');
    }
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

  // Generate config file if adapter has one. By default we preserve an
  // existing user-edited file. Adapters that mark `alwaysWriteConfig` (e.g.,
  // cloudflare's wrangler.toml) overwrite it on every build so the
  // generated `main = ...` path always matches the actual build output —
  // see #374.
  if (template.getConfig && template.configFileName) {
    const configPath = path.join(cwd, template.configFileName);
    const exists = await fileExists(configPath);

    const configContent = template.getConfig(cwd);
    const writeIt = async (): Promise<void> => {
      if (typeof configContent === 'string') {
        await fsp.writeFile(configPath, configContent, 'utf8');
      } else {
        await writeJSON(configPath, configContent);
      }
    };

    if (!exists) {
      await writeIt();
      console.log(c('green', `  Generated ${template.configFileName}`));
    } else if (template.alwaysWriteConfig) {
      await writeIt();
      console.log(c('green', `  Updated ${template.configFileName} (build output reference)`));
    } else {
      console.log(c('yellow', `  ${template.configFileName} already exists (skipping)`));
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

  // Try loading frontmcp.config for multi-target support.
  //
  // #365 — only swallow the "no config file present" case. If a config file
  // EXISTS but fails to load (e.g., a TS config under "type": "commonjs"
  // that the loader couldn't transpile), surface the error instead of
  // silently using defaults — that was the silent-corruption mode the
  // original loader had.
  let config: FrontMcpConfigParsed | undefined;
  const configExists = (
    await Promise.all(
      ['frontmcp.config.ts', 'frontmcp.config.js', 'frontmcp.config.json', 'frontmcp.config.mjs', 'frontmcp.config.cjs']
        .map((f) => fileExists(path.join(cwd, f))),
    )
  ).some(Boolean);
  if (configExists) {
    config = await loadFrontMcpConfig(cwd);
  } else {
    try {
      config = await loadFrontMcpConfig(cwd);
    } catch {
      // No config file present and no package.json → fall back to CLI flags only.
    }
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
  const deployment:DeploymentTarget | undefined = config ? findDeployment(config, target) : undefined;

  // Resolve output directory: deployment.outDir > CLI --out-dir > dist/{target}
  const baseOutDir = path.resolve(process.cwd(), opts.outDir || 'dist');
  const targetOutDir = deployment?.outDir
    ? path.resolve(process.cwd(), deployment.outDir)
    : path.join(baseOutDir, target);

  // Merge entry from config if not provided via CLI
  const entry = opts.entry || config?.entry;
  const targetOpts = { ...opts, outDir: targetOutDir, entry };

  // #370: forward `build.storage` and per-deployment `cli.outputDefault` from
  // the FrontMcp config into the exec build so the manifest reflects them.
  // The exec build has its own loader (`loadExecConfig`) that doesn't see
  // the deployment-level shape; passing these via opts merges them in
  // `normalizeConfig` before the manifest is generated.
  //
  // Only the cli deployment shape carries a `cli` block; map it down to the
  // narrow exec-config shape (outputDefault / description / authRequired) so
  // the result is a clean object, never `false`.
  const cliDeploymentConfig = deployment?.target === 'cli' ? deployment.cli : undefined;
  const execOverrides: {
    storage?: { type: 'sqlite' | 'redis' | 'none'; required?: boolean };
    cli?: { outputDefault?: 'text' | 'json'; description?: string; authRequired?: boolean };
  } = {
    storage: config?.build?.storage,
    cli: cliDeploymentConfig
      ? {
          ...(cliDeploymentConfig.outputDefault ? { outputDefault: cliDeploymentConfig.outputDefault } : {}),
          ...(cliDeploymentConfig.description ? { description: cliDeploymentConfig.description } : {}),
          ...(typeof cliDeploymentConfig.authRequired === 'boolean'
            ? { authRequired: cliDeploymentConfig.authRequired }
            : {}),
        }
      : undefined,
  };

  switch (target) {
    case 'cli': {
      const { buildExec } = await import('./exec/index.js');
      return buildExec({
        ...targetOpts,
        cli: true,
        sea: !opts.js,
        execOverrides,
      } as ParsedArgs & { cli: boolean; sea: boolean; execOverrides?: typeof execOverrides });
    }
    case 'node': {
      const { buildExec } = await import('./exec/index.js');
      return buildExec({
        ...targetOpts,
        execOverrides,
      } as ParsedArgs & { execOverrides?: typeof execOverrides });
    }
    case 'sdk': {
      const { buildSdk } = await import('./sdk/index.js');
      return buildSdk(targetOpts);
    }
    case 'browser': {
      const { buildBrowser } = await import('./browser/index.js');
      return buildBrowser(targetOpts);
    }
    case 'mcpb': {
      const { buildMcpb } = await import('./mcpb/index.js');
      return buildMcpb(targetOpts, config);
    }
    case 'vercel':
    case 'lambda':
    case 'cloudflare':
    case 'distributed': {
      const adapter = TARGET_TO_ADAPTER[target];
      return runAdapterBuild(targetOpts, adapter);
    }
    default:
      throw new Error(`Unknown build target: ${target}. Available: cli, node, sdk, browser, cloudflare, vercel, lambda, distributed, mcpb`);
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

  // #375 — adapter-level pre-validation: read the entry's @FrontMcp() config
  // metadata via the schema-extractor's lightweight path and let the adapter
  // reject incompatible features (sqlite/redis on Workers, etc.) before
  // emitting an unrunnable bundle.
  if (template.validate) {
    let decoratorConfig: Record<string, unknown> | undefined;
    try {
      // Best-effort: load the entry as a CJS require and pull the decorator's
      // attached metadata off the class. Failures are non-fatal — the build
      // continues and the adapter validate() falls back to a no-op.
      const Reflect = (globalThis as { Reflect?: { getMetadata?: (k: string, t: unknown) => unknown } }).Reflect;
      const prev = process.env['FRONTMCP_SCHEMA_EXTRACT'];
      process.env['FRONTMCP_SCHEMA_EXTRACT'] = '1';
      try {
        const mod = require(entry);
        const target = (mod && (mod.default || mod)) as unknown;
        if (typeof target === 'function' && Reflect?.getMetadata) {
          decoratorConfig = Reflect.getMetadata('__frontmcp:config', target) as Record<string, unknown> | undefined;
        } else if (target && typeof target === 'object') {
          decoratorConfig = target as Record<string, unknown>;
        }
      } finally {
        if (prev === undefined) delete process.env['FRONTMCP_SCHEMA_EXTRACT'];
        else process.env['FRONTMCP_SCHEMA_EXTRACT'] = prev;
      }
    } catch {
      /* fall through — adapter validate() handles undefined input */
    }
    template.validate(decoratorConfig);
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

import * as path from 'path';
import { ParsedArgs } from '../../args';
import { c } from '../../colors';
import { ensureDir, fileExists, runCmd, writeJSON } from '@frontmcp/utils';
import { fsp, resolveEntry } from '../../utils/fs';
import { REQUIRED_DECORATOR_FIELDS } from '../../tsconfig';
import { ADAPTERS } from './adapters';
import { AdapterName } from './types';
import { bundleForServerless } from './bundler';

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

/**
 * Build the FrontMCP server for a specific deployment target.
 *
 * @param opts - Build options from CLI arguments
 *
 * @example
 * ```bash
 * # Build for Node.js (default)
 * frontmcp build
 *
 * # Build for Vercel
 * frontmcp build --adapter vercel
 *
 * # Build for AWS Lambda
 * frontmcp build --adapter lambda
 *
 * # Build for Cloudflare Workers
 * frontmcp build --adapter cloudflare
 * ```
 */
export async function runBuild(opts: ParsedArgs): Promise<void> {
  // Executable bundle build (esbuild single-file + scripts)
  if (opts.exec) {
    const { buildExec } = await import('./exec');
    return buildExec(opts);
  }

  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const outDir = path.resolve(cwd, opts.outDir || 'dist');
  const adapter = (opts.adapter || 'node') as AdapterName;
  await ensureDir(outDir);

  // Validate adapter
  const template = ADAPTERS[adapter];
  if (!template) {
    const available = Object.keys(ADAPTERS).join(', ');
    throw new Error(`Unknown adapter: ${adapter}. Available: ${available}`);
  }

  // Warn about experimental adapters
  if (adapter === 'cloudflare') {
    console.log(
      c('yellow', '⚠️  Cloudflare Workers adapter is experimental. See docs for limitations.'),
    );
  }

  const moduleFormat = template.moduleFormat;

  console.log(`${c('cyan', '[build]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[build]')} outDir: ${path.relative(cwd, outDir)}`);
  console.log(`${c('cyan', '[build]')} adapter: ${adapter} (${moduleFormat})`);

  // Build TypeScript compiler arguments
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

  // Always pass module format to override tsconfig
  args.push('--module', moduleFormat);
  args.push('--outDir', outDir);
  args.push('--skipLibCheck');

  // Run TypeScript compiler
  await runCmd('npx', args);

  // Generate adapter-specific files
  if (adapter !== 'node') {
    console.log(c('cyan', `[build] Generating ${adapter} deployment files...`));
    const entryBasename = path.basename(entry);
    await generateAdapterFiles(adapter, outDir, entryBasename, cwd);
  }

  console.log(c('green', '✅ Build completed.'));
  console.log(c('gray', `Output placed in ${path.relative(cwd, outDir)}`));
}

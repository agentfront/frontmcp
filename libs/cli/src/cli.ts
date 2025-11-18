#!/usr/bin/env node
/**
 * frontmcp - FrontMCP command line interface
 * Save as bin/frontmcp.ts (compile to JS with shebang preserved) or run with tsx.
 */

import * as fs from 'fs';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { getSelfVersion } from './version';

/* ----------------------------- Types & Helpers ---------------------------- */

type Command = 'dev' | 'build' | 'init' | 'doctor' | 'inspector' | 'create' | 'help';

interface ParsedArgs {
  _: string[];
  outDir?: string;
  entry?: string;
  help?: boolean;
}

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const c = (color: keyof typeof COLORS, s: string) => COLORS[color] + s + COLORS.reset;

function showHelp(): void {
  console.log(`
${c('bold', 'frontmcp')} — FrontMCP command line interface

${c('bold', 'Usage')}
  frontmcp <command> [options]

${c('bold', 'Commands')}
  dev                 Start in development mode (tsx --watch <entry> + async type-check)
  build               Compile entry with TypeScript (tsc)
  init                Create or fix a tsconfig.json suitable for FrontMCP
  doctor              Check Node/npm versions and tsconfig requirements
  inspector           Launch MCP Inspector (npx @modelcontextprotocol/inspector)
  create <name>       Scaffold a new FrontMCP project in ./<name>
  help                Show this help message

${c('bold', 'Options')}
  -o, --out-dir <dir>  Output directory (default: ./dist)
  -e, --entry <path>   Manually specify entry file path

${c('bold', 'Examples')}
  frontmcp dev
  frontmcp build --out-dir build
  frontmcp init
  frontmcp doctor
  frontmcp inspector
  npx frontmcp create my-mcp
`);
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--entry' || a === '-e') out.entry = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else out._.push(a);
  }
  return out;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJSON<T = any>(jsonPath: string): Promise<T | null> {
  try {
    const buf = await fsp.readFile(jsonPath, 'utf8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

async function writeJSON(p: string, obj: any) {
  await fsp.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function tryCandidates(base: string): string[] {
  const exts = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs'];
  return exts.map((ext) => base + ext);
}

async function resolveEntry(cwd: string, explicit?: string): Promise<string> {
  if (explicit) {
    const full = path.resolve(cwd, explicit);
    if (await fileExists(full)) return full;
    throw new Error(`Entry override not found: ${explicit}`);
  }

  const pkgPath = path.join(cwd, 'package.json');
  if (await fileExists(pkgPath)) {
    const pkg = await readJSON<any>(pkgPath);
    if (pkg && typeof pkg.main === 'string' && pkg.main.trim()) {
      const mainCandidates = tryCandidates(path.resolve(cwd, pkg.main));
      for (const p of mainCandidates) {
        if (await fileExists(p)) return p;
      }
      const asDir = path.resolve(cwd, pkg.main);
      const idxCandidates = tryCandidates(path.join(asDir, 'index'));
      for (const p of idxCandidates) {
        if (await fileExists(p)) return p;
      }
    }
  }

  const fallback = path.join(cwd, 'src', 'main.ts');
  if (await fileExists(fallback)) return fallback;

  const msg = [
    c('red', 'No entry file found.'),
    '',
    'I looked for:',
    `  • ${pkgPath} with a valid "main" field`,
    `  • ${path.relative(cwd, fallback)}`,
    '',
    'Please create an entry file (e.g. src/main.ts) or set "main" in package.json,',
    'or run with an explicit path:',
    `  frontmcp dev --entry src/main.ts`,
  ].join('\n');
  throw new Error(msg);
}

function runCmd(cmd: string, args: string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true, ...opts });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    child.on('error', reject);
  });
}

async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

async function isDirEmpty(dir: string): Promise<boolean> {
  try {
    const items = await fsp.readdir(dir);
    return items.length === 0;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return true;
    throw e;
  }
}

function sanitizeForFolder(name: string): string {
  const seg = name.startsWith('@') && name.includes('/') ? name.split('/')[1] : name;
  return (
    seg
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'frontmcp-app'
  );
}

function sanitizeForNpm(name: string): string {
  if (name.startsWith('@') && name.includes('/')) {
    const [scope, pkg] = name.split('/');
    const s = scope.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    const p = pkg.replace(/[^a-z0-9._-]/gi, '-').toLowerCase();
    return `@${s}/${p || 'frontmcp-app'}`;
  }
  return name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase() || 'frontmcp-app';
}

/* --------------------------------- Actions -------------------------------- */

function isTsLike(p: string): boolean {
  return /\.tsx?$/i.test(p);
}

function killQuiet(proc?: ChildProcess) {
  try {
    if (proc) {
      proc.kill('SIGINT');
    }
  } catch {
    // Intentionally ignore shutdown errors.
  }
}

async function runDev(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);

  console.log(`${c('cyan', '[dev]')} using entry: ${path.relative(cwd, entry)}`);
  console.log(
    `${c('gray', '[dev]')} starting ${c('bold', 'tsx --watch')} and ${c(
      'bold',
      'tsc --noEmit --watch',
    )} (async type-checker)`,
  );
  console.log(`${c('gray', 'hint:')} press Ctrl+C to stop`);

  // Start tsx watcher (app run)
  const app = spawn('npx', ['-y', 'tsx', '--watch', entry], { stdio: 'inherit', shell: true });
  // Start tsc in watch mode for async type-checking (non-blocking)
  const checker = spawn('npx', ['-y', 'tsc', '--noEmit', '--pretty', '--watch'], {
    stdio: 'inherit',
    shell: true,
  });

  const cleanup = () => {
    killQuiet(checker);
    killQuiet(app);
  };

  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  await new Promise<void>((resolve, reject) => {
    app.on('close', (_code) => {
      // When app exits, stop checker too.
      cleanup();
      resolve();
    });
    app.on('error', (err) => {
      cleanup();
      reject(err);
    });
  });
}

async function runBuild(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();
  const entry = await resolveEntry(cwd, opts.entry);
  const outDir = path.resolve(cwd, opts.outDir || 'dist');
  await ensureDir(outDir);

  console.log(`${c('cyan', '[build]')} entry: ${path.relative(cwd, entry)}`);
  console.log(`${c('cyan', '[build]')} outDir: ${path.relative(cwd, outDir)}`);

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
    args.push('--module', REQUIRED_DECORATOR_FIELDS.module);
    args.push('--target', REQUIRED_DECORATOR_FIELDS.target);
  }

  args.push('--outDir', outDir);
  args.push('--skipLibCheck');

  await runCmd('npx', args);

  console.log(c('green', '✅ Build completed.'));
  console.log(c('gray', `Output placed in ${path.relative(cwd, outDir)}`));
}

/* --------------------------- tsconfig management --------------------------- */

const REQUIRED_DECORATOR_FIELDS = {
  target: 'es2021',
  module: 'esnext',
  emitDecoratorMetadata: true,
  experimentalDecorators: true,
  strictFunctionTypes: true,
  moduleResolution: 'node',
} as const;

const RECOMMENDED_TSCONFIG = {
  compilerOptions: {
    target: REQUIRED_DECORATOR_FIELDS.target,
    module: REQUIRED_DECORATOR_FIELDS.module,
    emitDecoratorMetadata: REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata,
    experimentalDecorators: REQUIRED_DECORATOR_FIELDS.experimentalDecorators,
    strictFunctionTypes: REQUIRED_DECORATOR_FIELDS.strictFunctionTypes,
    moduleResolution: REQUIRED_DECORATOR_FIELDS.moduleResolution,
    strict: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    skipLibCheck: true,
    sourceMap: true,
    outDir: 'dist',
    rootDir: 'src',
    types: ['node'],
  },
  include: ['src/**/*'],
} as const;

function deepMerge<T extends Record<string, any>, U extends Record<string, any>>(base: T, patch: U): T & U {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = deepMerge(base[k] ?? {}, v as Record<string, any>);
    } else {
      out[k] = v;
    }
  }
  return out as T & U;
}

function ensureRequiredTsOptions(obj: Record<string, any>): Record<string, any> {
  const next = { ...obj };
  next.compilerOptions = { ...(next.compilerOptions || {}) };
  next.compilerOptions.target = REQUIRED_DECORATOR_FIELDS.target;
  next.compilerOptions.module = REQUIRED_DECORATOR_FIELDS.module;
  next.compilerOptions.emitDecoratorMetadata = REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata;
  next.compilerOptions.experimentalDecorators = REQUIRED_DECORATOR_FIELDS.experimentalDecorators;
  return next;
}

function normalizeStr(x: unknown): string | undefined {
  return typeof x === 'string' ? x.toLowerCase() : undefined;
}

function checkRequiredTsOptions(compilerOptions: Record<string, any> | undefined) {
  const issues: string[] = [];
  const ok: string[] = [];

  const target = normalizeStr(compilerOptions?.target);
  const moduleVal = normalizeStr(compilerOptions?.module);
  const edm = compilerOptions?.emitDecoratorMetadata;
  const ed = compilerOptions?.experimentalDecorators;

  if (target === REQUIRED_DECORATOR_FIELDS.target)
    ok.push(`compilerOptions.target = "${REQUIRED_DECORATOR_FIELDS.target}"`);
  else issues.push(`compilerOptions.target should be "${REQUIRED_DECORATOR_FIELDS.target}"`);

  if (moduleVal === REQUIRED_DECORATOR_FIELDS.module)
    ok.push(`compilerOptions.module = "${REQUIRED_DECORATOR_FIELDS.module}"`);
  else issues.push(`compilerOptions.module should be "${REQUIRED_DECORATOR_FIELDS.module}"`);

  if (edm === REQUIRED_DECORATOR_FIELDS.emitDecoratorMetadata) ok.push(`compilerOptions.emitDecoratorMetadata = true`);
  else issues.push(`compilerOptions.emitDecoratorMetadata should be true`);

  if (ed === REQUIRED_DECORATOR_FIELDS.experimentalDecorators) ok.push(`compilerOptions.experimentalDecorators = true`);
  else issues.push(`compilerOptions.experimentalDecorators should be true`);

  return { ok, issues };
}

async function runInit(baseDir?: string): Promise<void> {
  const cwd = baseDir ?? process.cwd();
  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  const existing = await readJSON<Record<string, any>>(tsconfigPath);

  if (!existing) {
    console.log(c('yellow', `tsconfig.json not found — creating one in ${path.relative(process.cwd(), cwd) || '.'}.`));
    await writeJSON(tsconfigPath, RECOMMENDED_TSCONFIG);
    console.log(c('green', '✅ Created tsconfig.json with required decorator settings.'));
    return;
  }

  let merged = deepMerge(RECOMMENDED_TSCONFIG as any, existing);
  merged = ensureRequiredTsOptions(merged);

  await writeJSON(tsconfigPath, merged);
  console.log(c('green', '✅ tsconfig.json verified and updated (required decorator settings enforced).'));
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function runDoctor(): Promise<void> {
  const MIN_NODE = '22.0.0';
  const MIN_NPM = '10.0.0';
  const cwd = process.cwd();

  let ok = true;

  const nodeVer = process.versions.node;
  if (cmpSemver(nodeVer, MIN_NODE) >= 0) {
    console.log(`✅ Node ${nodeVer} (min ${MIN_NODE})`);
  } else {
    ok = false;
    console.log(`❌ Node ${nodeVer} — please upgrade to >= ${MIN_NODE}`);
  }

  let npmVer = 'unknown';
  try {
    npmVer = await new Promise<string>((resolve, reject) => {
      const child = spawn('npm', ['-v'], { shell: true });
      let out = '';
      child.stdout?.on('data', (d) => (out += String(d)));
      child.on('close', () => resolve(out.trim()));
      child.on('error', reject);
    });
    if (cmpSemver(npmVer, MIN_NPM) >= 0) {
      console.log(`✅ npm ${npmVer} (min ${MIN_NPM})`);
    } else {
      ok = false;
      console.log(`❌ npm ${npmVer} — please upgrade to >= ${MIN_NPM}`);
    }
  } catch {
    ok = false;
    console.log('❌ npm not found in PATH');
  }

  const tsconfigPath = path.join(cwd, 'tsconfig.json');
  if (await fileExists(tsconfigPath)) {
    console.log(`✅ tsconfig.json found`);
    const tsconfig = await readJSON<Record<string, any>>(tsconfigPath);
    const { ok: oks, issues } = checkRequiredTsOptions(tsconfig?.compilerOptions);
    for (const line of oks) console.log(c('green', `  ✓ ${line}`));
    if (issues.length) {
      ok = false;
      for (const line of issues) console.log(c('yellow', `  • ${line}`));
      console.log(c('cyan', `  -> Run "frontmcp init" to apply the required settings.`));
    }
  } else {
    ok = false;
    console.log(`❌ tsconfig.json not found — run ${c('cyan', 'frontmcp init')}`);
  }

  try {
    const entry = await resolveEntry(cwd);
    console.log(`✅ entry detected: ${path.relative(cwd, entry)}`);
  } catch (e: any) {
    const firstLine = (e?.message as string | undefined)?.split('\n')?.[0] ?? 'entry not found';
    console.log(`❌ entry not detected — ${firstLine}`);
  }

  if (ok) console.log(c('green', '\nAll checks passed. You are ready to go!'));
  else console.log(c('yellow', '\nSome checks failed. See above for fixes.'));
}

/* ------------------------------- Inspector -------------------------------- */

async function runInspector(): Promise<void> {
  console.log(`${c('cyan', '[inspector]')} launching MCP Inspector...`);
  await runCmd('npx', ['-y', '@modelcontextprotocol/inspector']);
}

/* --------------------------------- Create --------------------------------- */

function pkgNameFromCwd(cwd: string) {
  return (
    path
      .basename(cwd)
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .toLowerCase() || 'frontmcp-app'
  );
}

async function upsertPackageJson(cwd: string, nameOverride: string | undefined, selfVersion: string) {
  const pkgPath = path.join(cwd, 'package.json');
  const existing = await readJSON<Record<string, any>>(pkgPath);

  // Use caret range for libs to track the CLI version
  const frontmcpLibRange = `^${selfVersion}`;

  const base = {
    name: nameOverride ?? pkgNameFromCwd(cwd),
    version: '0.1.0',
    private: true,
    type: 'commonjs',
    main: 'src/main.ts',
    scripts: {
      dev: 'frontmcp dev',
      build: 'frontmcp build',
      inspect: 'frontmcp inspector',
      doctor: 'frontmcp doctor',
    },
    engines: {
      node: '>=22',
      npm: '>=10',
    },
    dependencies: {
      '@frontmcp/sdk': frontmcpLibRange,
      '@frontmcp/plugins': frontmcpLibRange,
      '@frontmcp/adapters': frontmcpLibRange,
      zod: '^3.25.76',
      'reflect-metadata': '^0.2.2',
    },
    devDependencies: {
      frontmcp: selfVersion, // exact CLI version used by npx
      tsx: '^4.20.6',
      '@types/node': '^22.0.0',
      typescript: '^5.5.3',
    },
  };

  if (!existing) {
    await writeJSON(pkgPath, base);
    console.log(c('green', '✅ Created package.json (synced @frontmcp libs to CLI version + exact frontmcp)'));
    return;
  }

  const merged: any = { ...base, ...existing };

  // Preserve some user fields if present
  merged.name = existing.name || base.name;
  merged.main = existing.main || base.main;
  merged.type = existing.type || base.type;

  merged.scripts = {
    ...base.scripts,
    ...(existing.scripts || {}),
    dev: existing.scripts?.dev ?? base.scripts.dev,
    build: existing.scripts?.build ?? base.scripts.build,
    inspect: existing.scripts?.inspect ?? base.scripts.inspect,
    doctor: existing.scripts?.doctor ?? base.scripts.doctor,
  };

  merged.engines = {
    ...(existing.engines || {}),
    node: existing.engines?.node || base.engines.node,
    npm: existing.engines?.npm || base.engines.npm,
  };

  // Force @frontmcp libs to follow the CLI version range
  merged.dependencies = {
    ...(existing.dependencies || {}),
    ...base.dependencies,
    '@frontmcp/sdk': frontmcpLibRange,
    '@frontmcp/plugins': frontmcpLibRange,
    '@frontmcp/adapters': frontmcpLibRange,
    zod: '^3.25.76',
    'reflect-metadata': '^0.2.2',
  };

  merged.devDependencies = {
    ...(existing.devDependencies || {}),
    ...base.devDependencies,
    frontmcp: selfVersion,
    tsx: '^4.20.6',
    typescript: '^5.5.3',
  };

  await writeJSON(pkgPath, merged);
  console.log(c('green', '✅ Updated package.json (synced @frontmcp libs + frontmcp to current CLI version)'));
}

async function scaffoldFileIfMissing(baseDir: string, p: string, content: string) {
  if (await fileExists(p)) {
    console.log(c('gray', `skip: ${path.relative(baseDir, p)} already exists`));
    return;
  }
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, content.replace(/^\n/, ''), 'utf8');
  console.log(c('green', `✓ created ${path.relative(baseDir, p)}`));
}

const TEMPLATE_MAIN_TS = `
import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { CalcApp } from './calc.app';

@FrontMcp({
  info: { name: 'Demo 🚀', version: '0.1.0' },
  apps: [CalcApp],
})
export default class Server {}
`;

const TEMPLATE_CALC_APP_TS = `
import { App } from '@frontmcp/sdk';
import AddTool from './tools/add.tool';

@App({
  id: 'calc',
  name: 'Calculator',
  tools: [AddTool],
})
export class CalcApp {}
`;

const TEMPLATE_ADD_TOOL_TS = `
import {Tool, ToolContext} from "@frontmcp/sdk";
import {z} from "zod";

@Tool({
  name: 'add',
  description: 'Add two numbers',
  inputSchema: {a: z.number(), b: z.number()},
  outputSchema: {result: z.number()}
})
export default class AddTool extends ToolContext {
  async execute(input: { a: number, b: number }) {
    return {
      result: input.a + input.b,
    };
  }
}
`;

async function runCreate(projectArg?: string): Promise<void> {
  if (!projectArg) {
    console.error(c('red', 'Error: project name is required.\n'));
    console.log(`Usage: ${c('bold', 'npx frontmcp create <project-name>')}`);
    process.exit(1);
  }

  const folder = sanitizeForFolder(projectArg);
  const pkgName = sanitizeForNpm(projectArg);
  const targetDir = path.resolve(process.cwd(), folder);

  if (await fileExists(targetDir)) {
    if (!(await isDirEmpty(targetDir))) {
      console.error(
        c('red', `Refusing to scaffold into non-empty directory: ${path.relative(process.cwd(), targetDir)}`),
      );
      console.log(c('gray', 'Pick a different name or start with an empty folder.'));
      process.exit(1);
    }
  } else {
    await ensureDir(targetDir);
  }

  console.log(
    `${c('cyan', '[create]')} Creating project in ${c('bold', './' + path.relative(process.cwd(), targetDir))}`,
  );
  process.chdir(targetDir);

  // 1) tsconfig
  await runInit(targetDir);

  // 2) package.json (pinned deps + exact CLI version)
  const selfVersion = getSelfVersion();
  await upsertPackageJson(targetDir, pkgName, selfVersion);

  // 3) files
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'main.ts'), TEMPLATE_MAIN_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'calc.app.ts'), TEMPLATE_CALC_APP_TS);
  await scaffoldFileIfMissing(targetDir, path.join(targetDir, 'src', 'tools', 'add.tool.ts'), TEMPLATE_ADD_TOOL_TS);

  console.log('\nNext steps:');
  console.log(`  1) cd ${folder}`);
  console.log('  2) npm install');
  console.log('  3) npm run dev     ', c('gray', '# tsx watcher + async tsc type-check'));
  console.log('  4) npm run inspect ', c('gray', '# launch MCP Inspector'));
  console.log('  5) npm run build   ', c('gray', '# compile with tsc via frontmcp build'));
}

/* --------------------------------- Main ----------------------------------- */

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);
  const cmd = parsed._[0] as Command | undefined;

  if (parsed.help || !cmd) {
    showHelp();
    process.exit(0);
  }

  try {
    switch (cmd) {
      case 'dev':
        await runDev(parsed);
        break;
      case 'build':
        parsed.outDir = parsed.outDir || 'dist';
        await runBuild(parsed);
        break;
      case 'init':
        await runInit();
        break;
      case 'doctor':
        await runDoctor();
        break;
      case 'inspector':
        await runInspector();
        break;
      case 'create': {
        const projectName = parsed._[1];
        await runCreate(projectName);
        break;
      }
      case 'help':
        showHelp();
        break;
      default:
        console.error(c('red', `Unknown command: ${cmd}`));
        showHelp();
        process.exitCode = 1;
    }
  } catch (err: any) {
    console.error('\n' + c('red', err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  }
}

main();

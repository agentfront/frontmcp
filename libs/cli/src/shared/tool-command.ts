/**
 * Run package-manager and tool binaries without a shell, on every platform (#731).
 *
 * On Windows `npm`, `npx`, `yarn` and `pnpm` are `.cmd` batch shims. Since
 * Node's CVE-2024-27980 fix (every Node this CLI supports) a shell-less
 * `spawn('npx.cmd')` throws `EINVAL`, a shell-less `spawn('npx')` fails with
 * `ENOENT`, and `{ shell: true }` works but emits DEP0190 on every run. Each
 * command is therefore resolved to something that runs without a shell:
 *
 *  1. A tool the project installs (`tsx`, `tsc`, `jest`, …): its JS entry, run
 *     with `process.execPath`. No npm process sits between the CLI and the tool,
 *     so signals and process-tree shutdown reach it directly.
 *  2. npm / npx on Windows: npm's own `npm-cli.js` / `npx-cli.js` — from
 *     `npm_execpath`, else the npm that ships next to `node.exe` — run with
 *     `process.execPath`.
 *  3. yarn / pnpm / bun on Windows: `npm_execpath` when it is that manager's
 *     script or executable, else the first match on `PATH`. An `.exe` runs
 *     directly; a `.cmd` shim runs through `cmd.exe /d /s /c` with every
 *     argument escaped for cmd.exe (the only case that needs a shell).
 *
 * Elsewhere the bare command runs as before: POSIX `spawn` finds it on `PATH`.
 */

import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import * as path from 'path';

import { fileExistsSync, readFileSync, runCmd } from '@frontmcp/utils';

/** A resolved command line, ready for {@link spawnTool} or {@link runTool}. */
export interface ToolCommand {
  /** What the user would type (`npm`, `tsx`) — used in messages. */
  label: string;
  command: string;
  args: string[];
  /** The arguments are already quoted for `cmd.exe`; pass them verbatim. */
  windowsVerbatimArguments?: boolean;
}

export type PackageManagerBinary = 'npm' | 'npx' | 'yarn' | 'pnpm' | 'bun';

/** Process facts the resolution reads. Injectable for tests. */
export interface ToolHost {
  platform: NodeJS.Platform;
  execPath: string;
  env: NodeJS.ProcessEnv;
  isFile: (file: string) => boolean;
  readJson: (file: string) => unknown;
  /** `require.resolve(request, { paths: [dir] })`, or `undefined` when it does not resolve. */
  resolveFrom: (request: string, dir: string) => string | undefined;
}

/** A tool shipped as an npm package bin, and how to reach it through npx when not installed. */
export interface ProjectToolSpec {
  /** npm package that ships the bin (`typescript`). */
  package: string;
  /** Bin name inside the package (`tsc`); defaults to the package name. */
  bin?: string;
  /** npx arguments that precede the tool's own when the project does not install it. */
  npx: string[];
}

function defaultHost(): ToolHost {
  return {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
    isFile: fileExistsSync,
    readJson: (file) => JSON.parse(readFileSync(file)) as unknown,
    resolveFrom: (request, dir) => {
      try {
        return require.resolve(request, { paths: [dir] });
      } catch {
        return undefined;
      }
    },
  };
}

function withHost(host?: Partial<ToolHost>): ToolHost {
  return { ...defaultHost(), ...host };
}

function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** Case-insensitive env lookup — Windows env names are (`Path`, `PATH`). */
function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

// ---------------------------------------------------------------------------
// Project tools
// ---------------------------------------------------------------------------

function findPackageDir(pkg: string, from: string, host: ToolHost): string | undefined {
  const p = pathFor(host.platform);
  const manifest = host.resolveFrom(`${pkg}/package.json`, from);
  if (manifest) return p.dirname(manifest);
  // A package whose `exports` hides `package.json`: walk node_modules upward.
  let dir = p.resolve(from);
  for (;;) {
    const candidate = p.join(dir, 'node_modules', pkg);
    if (host.isFile(p.join(candidate, 'package.json'))) return candidate;
    const parent = p.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Absolute path of `bin` from `pkg`, resolved from the first of `from` that
 * has the package installed. `undefined` when none does.
 */
export function resolvePackageBin(
  pkg: string,
  bin: string,
  from: readonly string[],
  host?: Partial<ToolHost>,
): string | undefined {
  const h = withHost(host);
  const p = pathFor(h.platform);
  for (const dir of from) {
    const pkgDir = findPackageDir(pkg, dir, h);
    if (!pkgDir) continue;
    let manifest: unknown;
    try {
      manifest = h.readJson(p.join(pkgDir, 'package.json'));
    } catch {
      continue;
    }
    const binField = (manifest as { bin?: unknown } | null)?.bin;
    // A string `bin` is named after the package (without its scope).
    const relative =
      typeof binField === 'string'
        ? bin === pkg.replace(/^@[^/]+\//, '')
          ? binField
          : undefined
        : binField && typeof binField === 'object'
          ? (binField as Record<string, unknown>)[bin]
          : undefined;
    if (typeof relative !== 'string') continue;
    const binPath = p.join(pkgDir, relative);
    if (h.isFile(binPath)) return binPath;
  }
  return undefined;
}

/**
 * The command line for a tool the project installs: its bin script run with
 * `process.execPath`, or `npx <spec.npx> <args>` when no directory in `from`
 * (default: the cwd) has it.
 */
export function projectToolCommand(
  spec: ProjectToolSpec,
  args: readonly string[],
  options: { from?: readonly string[]; host?: Partial<ToolHost> } = {},
): ToolCommand {
  const h = withHost(options.host);
  const bin = spec.bin ?? spec.package;
  const binPath = resolvePackageBin(spec.package, bin, options.from ?? [process.cwd()], h);
  if (binPath) return { label: bin, command: h.execPath, args: [binPath, ...args] };
  return packageManagerCommand('npx', [...spec.npx, ...args], h);
}

// ---------------------------------------------------------------------------
// Package managers
// ---------------------------------------------------------------------------

/** npm's `bin/npm-cli.js` or `bin/npx-cli.js`, or `undefined` when no npm is found. */
export function resolveNpmCliScript(which: 'npm' | 'npx', host?: Partial<ToolHost>): string | undefined {
  const h = withHost(host);
  const p = pathFor(h.platform);
  const script = which === 'npm' ? 'npm-cli.js' : 'npx-cli.js';
  const candidates: string[] = [];
  // Set by npm for every script it runs (`npm run dev`, `npx frontmcp`).
  const execpath = envValue(h.env, 'NPM_EXECPATH');
  if (execpath && /^np[mx]-cli\.js$/i.test(p.basename(execpath))) {
    candidates.push(p.join(p.dirname(execpath), script));
  }
  const nodeDir = p.dirname(h.execPath);
  // Windows installers put npm next to node.exe; POSIX prefixes under lib/.
  candidates.push(p.join(nodeDir, 'node_modules', 'npm', 'bin', script));
  candidates.push(p.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', script));
  return candidates.find((candidate) => h.isFile(candidate));
}

/** `npm_execpath` when it belongs to `manager` (yarn, pnpm and bun set it to themselves). */
function managerExecPath(manager: PackageManagerBinary, host: ToolHost): ToolCommand | undefined {
  const execpath = envValue(host.env, 'NPM_EXECPATH');
  if (!execpath) return undefined;
  const p = pathFor(host.platform);
  const base = p.basename(execpath).toLowerCase();
  if (!base.startsWith(manager)) return undefined;
  if (/\.[cm]?js$/.test(base)) return { label: manager, command: host.execPath, args: [execpath] };
  if (/\.(exe|com)$/.test(base)) return { label: manager, command: execpath, args: [] };
  return undefined;
}

/**
 * The command line for a package-manager binary. Runs without a shell on
 * every platform except a Windows `.cmd` shim that has no JS entry to call
 * (see the module header).
 */
export function packageManagerCommand(
  name: PackageManagerBinary,
  args: readonly string[],
  host?: Partial<ToolHost>,
): ToolCommand {
  const h = withHost(host);
  if (h.platform !== 'win32') return { label: name, command: name, args: [...args] };

  if (name === 'npm' || name === 'npx') {
    const script = resolveNpmCliScript(name, h);
    if (script) return { label: name, command: h.execPath, args: [script, ...args] };
  } else {
    const own = managerExecPath(name, h);
    if (own) return { ...own, args: [...own.args, ...args] };
  }
  return windowsCommand(name, args, h);
}

// ---------------------------------------------------------------------------
// Windows PATH lookup and cmd.exe quoting
// ---------------------------------------------------------------------------

/** First `name` + `PATHEXT` match on `PATH`, the way cmd.exe looks it up. */
export function findOnWindowsPath(name: string, host?: Partial<ToolHost>): string | undefined {
  const h = withHost(host);
  const dirs = (envValue(h.env, 'PATH') ?? '').split(';').filter(Boolean);
  const exts = (envValue(h.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.win32.join(dir.replace(/^"(.*)"$/, '$1'), `${name}${ext.toLowerCase()}`);
      if (h.isFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function windowsCommand(name: string, args: readonly string[], host: ToolHost): ToolCommand {
  const found = findOnWindowsPath(name, host);
  if (found && /\.(exe|com)$/i.test(found)) return { label: name, command: found, args: [...args] };
  return windowsShellCommand(name, found ?? name, args, host);
}

/** cmd.exe metacharacters, escaped with `^` (same set as cross-spawn). */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeCmdMeta(value: string): string {
  return value.replace(CMD_META, '^$1');
}

/**
 * Quote one argument by the `CommandLineToArgvW` rules: backslashes are
 * literal unless they precede a double quote (then they double) or the
 * closing quote.
 */
export function quoteWindowsArgument(arg: string): string {
  let out = '"';
  let backslashes = 0;
  for (const ch of arg) {
    if (ch === '\\') {
      backslashes++;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(backslashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(backslashes) + ch;
    }
    backslashes = 0;
  }
  return `${out}${'\\'.repeat(backslashes * 2)}"`;
}

/**
 * Run `command` through `cmd.exe /d /s /c` with every argument quoted and its
 * metacharacters escaped. A batch shim (`.cmd`/`.bat`, or a bare name cmd.exe
 * resolves) expands `%*` and parses the line once more, so its arguments are
 * escaped twice. The result must be spawned with `windowsVerbatimArguments`.
 */
export function windowsShellCommand(
  label: string,
  command: string,
  args: readonly string[],
  host?: Partial<ToolHost>,
): ToolCommand {
  const h = withHost(host);
  const batch = !/\.(exe|com)$/i.test(command);
  const escaped = args.map((arg) => {
    const once = escapeCmdMeta(quoteWindowsArgument(arg));
    return batch ? escapeCmdMeta(once) : once;
  });
  const line = [escapeCmdMeta(command), ...escaped].join(' ');
  return {
    label,
    command: envValue(h.env, 'COMSPEC') ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    windowsVerbatimArguments: true,
  };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

/** `spawn` a resolved tool. Never uses a shell. */
export function spawnTool(tool: ToolCommand, options: Omit<SpawnOptions, 'shell'> = {}): ChildProcess {
  return spawn(tool.command, tool.args, {
    ...options,
    shell: false,
    ...(tool.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
  });
}

/**
 * Run a resolved tool with inherited stdio and wait for it. Rejects when it
 * exits non-zero, naming the tool rather than `node.exe` or `cmd.exe`.
 */
export async function runTool(
  tool: ToolCommand,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<void> {
  try {
    await runCmd(tool.command, tool.args, {
      ...options,
      ...(tool.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
  } catch (err) {
    if (err instanceof Error && tool.command !== tool.label && err.message.startsWith(`${tool.command} `)) {
      err.message = `${tool.label}${err.message.slice(tool.command.length)}`;
    }
    throw err;
  }
}

/**
 * Project-defined CLI commands (issue #409).
 *
 * Reads `cli.commands` from the project's frontmcp.config and registers
 * each entry as a top-level Commander verb. The runner is spawned as a
 * child process (tsx for `.ts` entries, node for `.js`/`.mjs`/`.cjs`).
 *
 * Failure to load the config is non-fatal: project commands are an
 * optional layer on top of the built-in CLI, so a missing/broken config
 * just yields zero project commands and never blocks `frontmcp --help`.
 */

import { spawn } from 'child_process';
import * as path from 'path';

import type { Command } from 'commander';

import { tryLoadFrontMcpConfig } from '../config/frontmcp-config.loader';
import type {
  ProjectCommandArgument,
  ProjectCommandEntry,
  ProjectCommandOption,
} from '../config/frontmcp-config.types';
import { c } from './colors';

const PROJECT_COMMAND_MARK: unique symbol = Symbol.for('frontmcp.project-command');

interface ProjectCommandRecord {
  readonly verb: string;
  readonly entry: ProjectCommandEntry;
  readonly cwd: string;
}

/** Thrown when a dispatched runner exits non-zero or by signal. cli.ts uses
 * the exit code without printing the stack again. */
export class ProjectCommandFailedError extends Error {
  constructor(
    readonly verb: string,
    readonly exitCode: number,
    readonly signal: NodeJS.Signals | null,
  ) {
    super(
      signal
        ? `Project command "${verb}" terminated by signal ${signal}`
        : `Project command "${verb}" exited with code ${exitCode}`,
    );
    this.name = 'ProjectCommandFailedError';
  }
}

/**
 * Load `cli.commands` from `frontmcp.config` (in `cwd`) and attach each as
 * a top-level command on the program. No-op if no config is found.
 */
export async function registerProjectCommands(program: Command, cwd: string = process.cwd()): Promise<void> {
  const cfg = await safeLoad(cwd);
  const commands = cfg?.cli?.commands;
  if (!commands) return;

  for (const [verb, entry] of Object.entries(commands)) {
    try {
      const resolved = resolveAndCheckEntry(cwd, entry.entry);
      attachCommand(program, { verb, entry: { ...entry, entry: resolved }, cwd });
    } catch (err) {
      process.stderr.write(c('yellow', `⚠ Skipping project command "${verb}": ${(err as Error).message}\n`));
    }
  }
}

async function safeLoad(cwd: string): Promise<Awaited<ReturnType<typeof tryLoadFrontMcpConfig>>> {
  try {
    return await tryLoadFrontMcpConfig(cwd);
  } catch (err) {
    process.stderr.write(
      c('yellow', `⚠ Could not load frontmcp.config for project commands: ${(err as Error).message}\n`),
    );
    return undefined;
  }
}

/** Reject entry paths that escape the project cwd. */
function resolveAndCheckEntry(cwd: string, entry: string): string {
  if (path.isAbsolute(entry)) {
    throw new Error(`entry must be a project-relative path, not absolute: "${entry}"`);
  }
  const resolved = path.resolve(cwd, entry);
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`entry "${entry}" escapes the project directory`);
  }
  return resolved;
}

function attachCommand(program: Command, record: ProjectCommandRecord): void {
  const { verb, entry } = record;
  const cmd = program.command(verb);
  if (entry.description) cmd.description(entry.description);
  if (entry.hidden) {
    (cmd as unknown as { _hidden: boolean })._hidden = true;
  }

  for (const arg of entry.arguments ?? []) {
    cmd.argument(formatArgumentToken(arg), arg.description ?? '');
  }

  for (const opt of entry.options ?? []) {
    if (opt.default !== undefined) {
      // Commander v13 types only allow string/boolean/string[] as a default,
      // but accepts arbitrary JS values at runtime. Cast to keep numbers
      // (e.g. `default: 4` for a `<num>` flag) flowing through as-is.
      cmd.option(opt.flags, opt.description ?? '', opt.default as string | boolean | string[]);
    } else {
      cmd.option(opt.flags, opt.description ?? '');
    }
  }

  cmd.action(async (...args: unknown[]) => {
    await dispatchToEntry(record, args);
  });

  (cmd as unknown as Record<symbol, boolean>)[PROJECT_COMMAND_MARK] = true;
}

function formatArgumentToken(arg: ProjectCommandArgument): string {
  const inner = arg.variadic ? `${arg.name}...` : arg.name;
  return arg.required ? `<${inner}>` : `[${inner}]`;
}

/**
 * Spawn the project entry file as a child process and forward stdio. The
 * child receives positionals as argv plus a `FRONTMCP_PROJECT_COMMAND` env
 * var with the full payload (verb, positionals, options, cwd) so the runner
 * can reconstruct context without re-parsing argv.
 *
 * Throws `ProjectCommandFailedError` (not a generic Error) on non-zero exit
 * so cli.ts can exit with the child's code without re-printing the message.
 */
export async function dispatchToEntry(record: ProjectCommandRecord, actionArgs: unknown[]): Promise<void> {
  // Commander invokes action with: ...positionals, options, command
  const options = (actionArgs[actionArgs.length - 2] ?? {}) as Record<string, unknown>;
  const positionals = actionArgs.slice(0, actionArgs.length - 2);

  const entryAbs = record.entry.entry; // already resolved + safety-checked at register time
  const runner = pickRunner(entryAbs);

  const payload = {
    verb: record.verb,
    positionals,
    options,
    cwd: record.cwd,
  };

  const childArgv = [...runner.args, entryAbs, ...flattenPositionals(positionals), ...flattenOptions(options)];

  const child = spawn(runner.cmd, childArgv, {
    cwd: record.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      FRONTMCP_PROJECT_COMMAND: JSON.stringify(payload),
    },
  });

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new ProjectCommandFailedError(record.verb, 1, signal));
        return;
      }
      if (code !== 0) {
        reject(new ProjectCommandFailedError(record.verb, code ?? 1, null));
        return;
      }
      resolve();
    });
  });
}

interface Runner {
  cmd: string;
  args: string[];
}

function pickRunner(entryAbs: string): Runner {
  const ext = path.extname(entryAbs).toLowerCase();
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') {
    return { cmd: process.execPath, args: ['--import', 'tsx'] };
  }
  return { cmd: process.execPath, args: [] };
}

function flattenPositionals(positionals: unknown[]): string[] {
  const out: string[] = [];
  for (const v of positionals) {
    if (Array.isArray(v)) {
      for (const item of v) out.push(String(item));
    } else if (v !== undefined && v !== null) {
      out.push(String(v));
    }
  }
  return out;
}

/**
 * Forward parsed options to the child as long-flag tokens so a runner that
 * uses its own argv parser (Commander, yargs, etc.) sees the same values
 * the parent did. Booleans become `--flag` (when true; omitted when false);
 * other scalars become `--flag value`; arrays repeat the flag per element.
 */
function flattenOptions(options: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(options)) {
    const flag = `--${toKebab(key)}`;
    if (value === undefined || value === null) continue;
    if (value === true) {
      out.push(flag);
    } else if (value === false) {
      // omit; absence is the default false
    } else if (Array.isArray(value)) {
      for (const item of value) {
        out.push(flag, String(item));
      }
    } else {
      out.push(flag, String(value));
    }
  }
  return out;
}

function toKebab(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

export function isProjectCommand(cmd: Command): boolean {
  return (cmd as unknown as Record<symbol, boolean>)[PROJECT_COMMAND_MARK] === true;
}

export function isCommandHidden(cmd: Command): boolean {
  return (cmd as unknown as { _hidden?: boolean })._hidden === true;
}

// Re-export the unused-types so external consumers can build option specs.
export type { ProjectCommandEntry, ProjectCommandOption };

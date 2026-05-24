import { Command } from 'commander';

import { registerBuildCommands } from '../commands/build/register';
import { registerDevCommands } from '../commands/dev/register';
import { registerEjectCommands } from '../commands/eject/register';
import { registerInstallCommands } from '../commands/install/register';
import { registerMcpbCommands } from '../commands/mcpb/register';
import { registerPackageCommands } from '../commands/package/register';
import { registerPmCommands } from '../commands/pm/register';
import { registerScaffoldCommands } from '../commands/scaffold/register';
import { registerSkillsCommands } from '../commands/skills/register';
import { customizeHelp } from './help';
import { registerProjectCommands } from './project-commands';
import { getSelfVersion } from './version';

/**
 * Skip project-command registration for invocations that only print the
 * package version (`frontmcp --version` / `-V`) — those don't need the
 * config-load cost.
 *
 * Bare `frontmcp` and `frontmcp --help` / `-h` DO need the load: both
 * render the help banner, which must include project verbs registered
 * via `cli.commands` (issue #409). `--list-commands` also needs the
 * load — that's the whole point of the flag.
 */
function shouldSkipProjectCommandLoad(argv: string[]): boolean {
  const args = argv.slice(2);
  // Bare `frontmcp` shows the help banner → must include project verbs.
  if (args.length === 0) return false;
  const firstVerbIdx = args.findIndex((a) => !a.startsWith('-'));
  if (firstVerbIdx !== -1) return false;
  // No verb token — pure flag invocation. `--list-commands` and the
  // help flags all render output that must include project verbs.
  if (args.includes('--list-commands')) return false;
  if (args.includes('--help') || args.includes('-h')) return false;
  // What's left is --version / -V (or any pure metadata flag that
  // doesn't render the verb listing). Skip the project-command load.
  const metadataFlags = new Set(['--version', '-V']);
  return args.every((a) => metadataFlags.has(a));
}

export async function createProgram(cwd: string = process.cwd(), argv: string[] = process.argv): Promise<Command> {
  const program = new Command();

  program
    .name('frontmcp')
    .description('Build, test, and deploy MCP servers with FrontMCP')
    .version(getSelfVersion(), '-V, --version')
    .option('--list-commands', 'List every registered verb (built-in + project) and exit')
    // Issue #400 — top-level `--config <path>` option. Commands that
    // consume the unified config (dev, test, inspector, eject, pm, skills) read
    // `program.opts().config` (or `FRONTMCP_CONFIG` env) to locate the
    // file. Override precedence:
    //   explicit --config > FRONTMCP_CONFIG > upward walk from cwd
    .option('-c, --config <path>', 'Path to frontmcp.config file (overrides upward search and FRONTMCP_CONFIG env)');

  registerDevCommands(program);
  registerBuildCommands(program);
  registerScaffoldCommands(program);
  registerPmCommands(program);
  registerPackageCommands(program);
  registerSkillsCommands(program);
  registerMcpbCommands(program);
  registerEjectCommands(program);
  registerInstallCommands(program);

  if (!shouldSkipProjectCommandLoad(argv)) {
    await registerProjectCommands(program, cwd);
  }

  customizeHelp(program);

  return program;
}

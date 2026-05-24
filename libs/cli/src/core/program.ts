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
 * Skip project-command registration for metadata-only invocations
 * (`frontmcp`, `frontmcp --version`, `frontmcp -h`, `frontmcp --help` with
 * no verb) so users don't pay the config-load cost on the help/version
 * hot paths. `--list-commands` DOES need the load — that's the whole
 * point of the flag.
 */
function shouldSkipProjectCommandLoad(argv: string[]): boolean {
  const args = argv.slice(2);
  if (args.length === 0) return true;
  const firstVerbIdx = args.findIndex((a) => !a.startsWith('-'));
  if (firstVerbIdx !== -1) return false;
  // No verb token — pure flag invocation. Skip unless one of those flags
  // is --list-commands (which needs the project commands to enumerate).
  if (args.includes('--list-commands')) return false;
  const metadataFlags = new Set(['--version', '-V', '--help', '-h']);
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

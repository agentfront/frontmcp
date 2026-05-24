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
import { getSelfVersion } from './version';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('frontmcp')
    .description('Build, test, and deploy MCP servers with FrontMCP')
    .version(getSelfVersion(), '-V, --version')
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
  customizeHelp(program);

  return program;
}

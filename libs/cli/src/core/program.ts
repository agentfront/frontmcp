import { Command } from 'commander';

import { registerBuildCommands } from '../commands/build/register';
import { registerDevCommands } from '../commands/dev/register';
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
    .version(getSelfVersion(), '-V, --version');

  registerDevCommands(program);
  registerBuildCommands(program);
  registerScaffoldCommands(program);
  registerPmCommands(program);
  registerPackageCommands(program);
  registerSkillsCommands(program);
  registerMcpbCommands(program);
  customizeHelp(program);

  return program;
}

import { Command } from 'commander';
import { getSelfVersion } from './version';
import { registerDevCommands } from '../commands/dev/register';
import { registerBuildCommands } from '../commands/build/register';
import { registerScaffoldCommands } from '../commands/scaffold/register';
import { registerPmCommands } from '../commands/pm/register';
import { registerPackageCommands } from '../commands/package/register';
import { customizeHelp } from './help';

export function createProgram(): Command {
  const program = new Command();

  program.name('frontmcp').description('FrontMCP command line interface').version(getSelfVersion(), '-V, --version');

  registerDevCommands(program);
  registerBuildCommands(program);
  registerScaffoldCommands(program);
  registerPmCommands(program);
  registerPackageCommands(program);
  customizeHelp(program);

  return program;
}

import { Command } from 'commander';
import { toParsedArgs } from '../../core/bridge';

export function registerPackageCommands(program: Command): void {
  program
    .command('install')
    .description('Install an MCP app from npm, local path, or git')
    .argument('<source>', 'Package source (npm package, local path, or github:user/repo)')
    .option('--registry <url>', 'npm registry URL for private packages')
    .option('-y, --yes', 'Silent mode (use defaults, skip questionnaire)')
    .option('-p, --port <N>', 'Override default port', parseInt)
    .action(async (source: string, options) => {
      const { runInstall } = await import('./install.js');
      await runInstall(toParsedArgs('install', [source], options));
    });

  program
    .command('uninstall')
    .description('Remove an installed MCP app')
    .argument('<name>', 'App name')
    .action(async (name: string) => {
      const { runUninstall } = await import('./uninstall.js');
      await runUninstall(toParsedArgs('uninstall', [name], {}));
    });

  program
    .command('configure')
    .description('Re-run setup questionnaire for an installed app')
    .argument('<name>', 'App name')
    .option('-y, --yes', 'Silent mode (use defaults)')
    .action(async (name: string, options) => {
      const { runConfigure } = await import('./configure.js');
      await runConfigure(toParsedArgs('configure', [name], options));
    });
}

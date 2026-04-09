import type { Command } from 'commander';
import { toParsedArgs } from '../../core/bridge';

const BUILD_TARGETS = ['cli', 'node', 'sdk', 'browser', 'cloudflare', 'vercel', 'lambda', 'distributed'];

export function registerBuildCommands(program: Command): void {
  program
    .command('build')
    .description('Build for a deployment target')
    .option('-t, --target <target>', `Build target: ${BUILD_TARGETS.join(', ')}`)
    .option('--js', 'Output JS bundle instead of native binary (cli target only)')
    .option('-o, --out-dir <dir>', 'Output directory')
    .option('-e, --entry <path>', 'Manually specify entry file path')
    .action(async (options) => {
      options.outDir = options.outDir || 'dist';
      const { runBuild } = await import('./index.js');
      await runBuild(toParsedArgs('build', [], options));
    });
}

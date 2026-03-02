import { Command } from 'commander';
import { toParsedArgs } from '../../core/bridge';

export function registerBuildCommands(program: Command): void {
  program
    .command('build')
    .description('Compile entry with TypeScript (tsc)')
    .option('-o, --out-dir <dir>', 'Output directory')
    .option('-e, --entry <path>', 'Manually specify entry file path')
    .option('-a, --adapter <name>', 'Deployment adapter: node, vercel, lambda, cloudflare')
    .option('--exec', 'Build distributable executable bundle (esbuild)')
    .option('--cli', 'Generate CLI with subcommands per tool (use with --exec)')
    .action(async (options) => {
      options.outDir = options.outDir || 'dist';
      const { runBuild } = await import('./index.js');
      await runBuild(toParsedArgs('build', [], options));
    });
}

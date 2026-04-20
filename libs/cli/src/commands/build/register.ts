import type { Command } from 'commander';
import { toParsedArgs } from '../../core/bridge';

const BUILD_TARGETS = ['cli', 'node', 'sdk', 'browser', 'cloudflare', 'vercel', 'lambda', 'distributed', 'mcpb'];

export function registerBuildCommands(program: Command): void {
  program
    .command('build')
    .description('Build for a deployment target')
    .option('-t, --target <target>', `Build target: ${BUILD_TARGETS.join(', ')}`)
    .option('--js', 'Output JS bundle instead of native binary (cli target only)')
    .option('-o, --out-dir <dir>', 'Output directory')
    .option('-e, --entry <path>', 'Manually specify entry file path')
    // MCPB-specific flags
    .option('--sea', 'Build an SEA binary for the host platform and embed it in the bundle (mcpb target)')
    .option('--merge-from <dir>', 'Directory of pre-built cross-platform SEA binaries to merge (mcpb target)')
    .option('--icon <path>', 'Override icon path (mcpb target)')
    .option('--no-deterministic', 'Disable deterministic archive output (mcpb target)')
    .option('--stage-only', 'Leave the MCPB staging directory intact and skip zipping (mcpb target)')
    .action(async (options) => {
      options.outDir = options.outDir || 'dist';
      const { runBuild } = await import('./index.js');
      await runBuild(toParsedArgs('build', [], options));
    });
}

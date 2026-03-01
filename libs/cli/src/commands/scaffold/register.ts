import { Command } from 'commander';

export function registerScaffoldCommands(program: Command): void {
  program
    .command('create')
    .description('Scaffold a new FrontMCP project (interactive if name omitted)')
    .argument('[name]', 'Project name')
    .option('-y, --yes', 'Use defaults (non-interactive mode)')
    .option('--target <target>', 'Deployment target: node, vercel, lambda, cloudflare')
    .option('--redis <setup>', 'Redis setup: docker, existing, none (node target only)')
    .option('--pm <pm>', 'Package manager: npm, yarn, pnpm')
    .option('--cicd', 'Enable GitHub Actions CI/CD')
    .option('--no-cicd', 'Disable GitHub Actions CI/CD')
    .option('--nx', 'Scaffold an Nx monorepo instead of standalone project')
    .action(
      async (
        name: string | undefined,
        options: { yes?: boolean; target?: string; redis?: string; pm?: string; cicd?: boolean; nx?: boolean },
      ) => {
        const { runCreate } = await import('./create.js');
        await runCreate(name, {
          yes: options.yes,
          target: options.target,
          redis: options.redis,
          cicd: options.cicd,
          pm: options.pm,
          nx: options.nx,
        });
      },
    );
}

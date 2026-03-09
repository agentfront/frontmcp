import { Command } from 'commander';
import { toParsedArgs } from '../../core/bridge';

export function registerDevCommands(program: Command): void {
  program
    .command('dev')
    .description('Start in development mode (tsx --watch + async type-check)')
    .option('-e, --entry <path>', 'Entry file path')
    .action(async (options) => {
      const { runDev } = await import('./dev.js');
      await runDev(toParsedArgs('dev', [], options));
    });

  program
    .command('test')
    .description('Run E2E tests with auto-injected Jest configuration')
    .argument('[patterns...]', 'Test file patterns')
    .option('-i, --runInBand', 'Run tests sequentially (recommended for E2E)')
    .option('-w, --watch', 'Run tests in watch mode')
    .option('-v, --verbose', 'Show verbose test output')
    .option('-t, --timeout <ms>', 'Set test timeout (default: 60000ms)', parseInt)
    .option('-c, --coverage', 'Collect test coverage')
    .action(async (patterns: string[], options) => {
      const { runTest } = await import('./test.js');
      await runTest(toParsedArgs('test', patterns, options));
    });

  program
    .command('init')
    .description('Create or fix a tsconfig.json suitable for FrontMCP')
    .action(async () => {
      const { runInit } = await import('../../core/tsconfig.js');
      await runInit();
    });

  program
    .command('doctor')
    .description('Check Node/npm versions and tsconfig requirements')
    .action(async () => {
      const { runDoctor } = await import('./doctor.js');
      await runDoctor();
    });

  program
    .command('inspector')
    .description('Launch MCP Inspector (npx @modelcontextprotocol/inspector)')
    .action(async () => {
      const { runInspector } = await import('./inspector.js');
      await runInspector();
    });
}

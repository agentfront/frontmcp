import { type Command } from 'commander';

import { toParsedArgs } from '../../core/bridge';

export function registerDevCommands(program: Command): void {
  program
    .command('dev')
    .description('Start in development mode (tsx --watch + async type-check)')
    .option('-e, --entry <path>', 'Entry file path')
    .option('-p, --port <port>', 'TCP port to listen on (sets PORT env for the child)', (v) => parseInt(v, 10))
    .option('--auto-port', 'If the chosen port is busy, auto-pick the next free port')
    .option('--show-conflict', 'On EADDRINUSE, print the process holding the port (uses lsof on POSIX)')
    .action(async (options, cmd: { parent?: { opts?: () => Record<string, unknown> } }) => {
      const { runDev } = await import('./dev.js');
      // Issue #400 — forward the top-level --config flag into the command's
      // ParsedArgs so `runDev`'s resolveConfig() call picks it up.
      const topOpts = cmd.parent?.opts?.() ?? {};
      if (typeof topOpts['config'] === 'string') options.config = topOpts['config'];
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
    .action(async (patterns: string[], options, cmd: { parent?: { opts?: () => Record<string, unknown> } }) => {
      const { runTest } = await import('./test.js');
      const topOpts = cmd.parent?.opts?.() ?? {};
      if (typeof topOpts['config'] === 'string') options.config = topOpts['config'];
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
    .action(async (_args, cmd: { parent?: { opts?: () => Record<string, unknown> } }) => {
      const { runInspector } = await import('./inspector.js');
      const opts = cmd.parent?.opts?.() ?? {};
      await runInspector({
        _: [],
        config: typeof opts['config'] === 'string' ? (opts['config'] as string) : undefined,
      } as never);
    });
}

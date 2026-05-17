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
    // Issue #399 — first-party watch-aware stdio bridge. Replaces the
    // `npx mcp-remote` recipe for the dev loop; the bridge holds the
    // stdio connection across user-code restarts so MCP clients (Claude
    // Code, etc.) don't sit on `Calling…` after every save.
    .option('--stdio', 'Run frontmcp dev as a stdio bridge for an MCP client')
    .option('--serve', 'Use stdio-over-pipe to the child (default: HTTP/SSE loopback)')
    .option('--log-file <path>', 'Bridge log file path', './.frontmcp/dev.log')
    .option('--buffer-size <n>', 'Max RPCs buffered during reload', (v) => parseInt(v, 10))
    .option('--reload-deadline-ms <ms>', 'Time to wait for a reload to complete', (v) => parseInt(v, 10))
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

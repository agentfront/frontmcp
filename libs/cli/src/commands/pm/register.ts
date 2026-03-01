import { Command } from 'commander';
import { toParsedArgs } from '../../core/bridge';

export function registerPmCommands(program: Command): void {
  program
    .command('start')
    .description('Start a named MCP server with supervisor')
    .argument('<name>', 'Process name')
    .option('-e, --entry <path>', 'Entry file for the server')
    .option('-p, --port <N>', 'Port number for the server', parseInt)
    .option('-s, --socket <path>', 'Unix socket path')
    .option('--db <path>', 'SQLite database path')
    .option('--max-restarts <N>', 'Maximum auto-restart attempts (default: 5)', parseInt)
    .action(async (name: string, options) => {
      const { runStart } = await import('./start.js');
      await runStart(toParsedArgs('start', [name], options));
    });

  program
    .command('stop')
    .description('Stop a managed server (graceful by default)')
    .argument('<name>', 'Process name')
    .option('-f, --force', 'Force kill (SIGKILL instead of SIGTERM)')
    .action(async (name: string, options) => {
      const { runStop } = await import('./stop.js');
      await runStop(toParsedArgs('stop', [name], options));
    });

  program
    .command('restart')
    .description('Restart a managed server')
    .argument('<name>', 'Process name')
    .action(async (name: string) => {
      const { runRestart } = await import('./restart.js');
      await runRestart(toParsedArgs('restart', [name], {}));
    });

  program
    .command('status')
    .description('Show process status (detail if name given, table if omitted)')
    .argument('[name]', 'Process name')
    .action(async (name: string | undefined) => {
      const { runStatus } = await import('./status.js');
      await runStatus(toParsedArgs('status', name ? [name] : [], {}));
    });

  program
    .command('list')
    .description('List all managed processes')
    .action(async () => {
      const { runList } = await import('./list.js');
      await runList(toParsedArgs('list', [], {}));
    });

  program
    .command('logs')
    .description('Tail log output for a managed server')
    .argument('<name>', 'Process name')
    .option('-F, --follow', 'Follow log output (like tail -f)')
    .option('-n, --lines <N>', 'Number of lines to show (default: 50)', parseInt)
    .action(async (name: string, options) => {
      const { runLogs } = await import('./logs.js');
      await runLogs(toParsedArgs('logs', [name], options));
    });

  program
    .command('service')
    .description('Install/uninstall systemd/launchd service')
    .argument('<action>', 'Action: install or uninstall')
    .argument('[name]', 'Service name')
    .action(async (action: string, name: string | undefined) => {
      const { runService } = await import('./service.js');
      const positionals = name ? [action, name] : [action];
      await runService(toParsedArgs('service', positionals, {}));
    });

  program
    .command('socket')
    .description('Start Unix socket daemon for local MCP server')
    .argument('<entry>', 'Entry file path')
    .option('-s, --socket <path>', 'Unix socket path (default: ~/.frontmcp/sockets/{app}.sock)')
    .option('--db <path>', 'SQLite database path for persistence')
    .option('-b, --background', 'Run as background daemon (detached process)')
    .action(async (entry: string, options) => {
      const { runSocket } = await import('./socket.js');
      await runSocket(toParsedArgs('socket', [entry], options));
    });
}

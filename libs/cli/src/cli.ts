#!/usr/bin/env node
/**
 * frontmcp - FrontMCP command line interface
 */

import { c } from './colors';
import { Command, ParsedArgs, parseArgs } from './args';
import { runDev } from './commands/dev';
import { runBuild } from './commands/build';
import { runInit } from './tsconfig';
import { runDoctor } from './commands/doctor';
import { runInspector } from './commands/inspector';
import { runCreate } from './commands/create';
import { runTemplate } from './commands/template';
import { runTest } from './commands/test';
import { runSocket } from './commands/socket';

function showHelp(): void {
  console.log(`
${c('bold', 'frontmcp')} — FrontMCP command line interface

${c('bold', 'Usage')}
  frontmcp <command> [options]

${c('bold', 'Development')}
  dev                 Start in development mode (tsx --watch <entry> + async type-check)
  build               Compile entry with TypeScript (tsc)
  build --exec        Build distributable executable bundle (esbuild)
  test                Run E2E tests with auto-injected Jest configuration
  init                Create or fix a tsconfig.json suitable for FrontMCP
  doctor              Check Node/npm versions and tsconfig requirements
  inspector           Launch MCP Inspector (npx @modelcontextprotocol/inspector)
  create [name]       Scaffold a new FrontMCP project (interactive if name omitted)
  template <type>     Scaffold a template by type (e.g., "3rd-party-integration")
  socket <entry>      Start Unix socket daemon for local MCP server

${c('bold', 'Process Manager')}
  start <name>        Start a named MCP server with supervisor
  stop <name>         Stop a managed server (graceful by default)
  restart <name>      Restart a managed server
  status [name]       Show process status (detail if name given, table if omitted)
  list                List all managed processes
  logs <name>         Tail log output for a managed server
  service <action>    Install/uninstall systemd/launchd service

${c('bold', 'Package Manager')}
  install <source>    Install an MCP app from npm, local path, or git
  uninstall <name>    Remove an installed MCP app
  configure <name>    Re-run setup questionnaire for an installed app

${c('bold', 'General Options')}
  -h, --help           Show this help message
  -o, --out-dir <dir>  Output directory (default: ./dist)
  -e, --entry <path>   Manually specify entry file path

${c('bold', 'Build Options')}
  --exec               Build distributable executable bundle
  -a, --adapter <name> Deployment adapter: node, vercel, lambda, cloudflare

${c('bold', 'Start Options')}
  -e, --entry <path>   Entry file for the server
  -p, --port <N>       Port number for the server
  -s, --socket <path>  Unix socket path
  --db <path>          SQLite database path
  --max-restarts <N>   Maximum auto-restart attempts (default: 5)

${c('bold', 'Stop Options')}
  -f, --force          Force kill (SIGKILL instead of SIGTERM)

${c('bold', 'Logs Options')}
  -F, --follow         Follow log output (like tail -f)
  -n, --lines <N>      Number of lines to show (default: 50)

${c('bold', 'Install Options')}
  --registry <url>     npm registry URL for private packages
  -y, --yes            Silent mode (use defaults, skip questionnaire)
  -p, --port <N>       Override default port

${c('bold', 'Create Options')}
  -y, --yes            Use defaults (non-interactive mode)
  --target <target>    Deployment target: node, vercel, lambda, cloudflare
  --redis <setup>      Redis setup: docker, existing, none (node target only)
  --pm <pm>            Package manager: npm, yarn, pnpm
  --cicd               Enable GitHub Actions CI/CD
  --no-cicd            Disable GitHub Actions CI/CD

${c('bold', 'Socket Options')}
  -s, --socket <path>  Unix socket path (default: ~/.frontmcp/sockets/{app}.sock)
  --db <path>          SQLite database path for persistence
  -b, --background     Run as background daemon (detached process)

${c('bold', 'Test Options')}
  -i, --runInBand      Run tests sequentially (recommended for E2E)
  -w, --watch          Run tests in watch mode
  -v, --verbose        Show verbose test output
  -t, --timeout <ms>   Set test timeout (default: 60000ms)
  -c, --coverage       Collect test coverage

${c('bold', 'Examples')}
  frontmcp dev
  frontmcp build --out-dir build
  frontmcp build --exec
  frontmcp test --runInBand
  frontmcp init
  frontmcp doctor
  frontmcp inspector
  npx frontmcp create                          # Interactive mode
  npx frontmcp create my-mcp --yes             # Use defaults
  npx frontmcp create my-mcp --target vercel   # Vercel deployment
  npx frontmcp template marketplace-3rd-tools
  frontmcp socket ./src/main.ts --socket /tmp/my-app.sock
  frontmcp socket ./src/main.ts --socket /tmp/my-app.sock --db ~/.frontmcp/data/app.sqlite
  frontmcp start my-app --entry ./src/main.ts --port 3005
  frontmcp stop my-app
  frontmcp logs my-app --follow
  frontmcp service install my-app
  frontmcp install @company/my-mcp --registry https://npm.company.com
  frontmcp install ./my-local-app
  frontmcp install github:user/repo
  frontmcp configure my-app
  frontmcp uninstall my-app
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const parsed: ParsedArgs = parseArgs(argv);
  const cmd = parsed._[0] as Command | undefined;

  if (parsed.help || !cmd) {
    showHelp();
    process.exit(0);
  }

  try {
    switch (cmd) {
      case 'dev':
        await runDev(parsed);
        break;
      case 'build':
        parsed.outDir = parsed.outDir || 'dist';
        await runBuild(parsed);
        break;
      case 'init':
        await runInit();
        break;
      case 'doctor':
        await runDoctor();
        break;
      case 'inspector':
        await runInspector();
        break;
      case 'create': {
        const projectName = parsed._[1];
        await runCreate(projectName, {
          yes: parsed.yes,
          target: parsed.target,
          redis: parsed.redis,
          cicd: parsed.cicd,
          pm: parsed.pm,
        });
        break;
      }
      case 'template': {
        const type = parsed._[1]; // e.g. "3rd-party-integration"
        await runTemplate(type);
        break;
      }
      case 'test':
        await runTest(parsed);
        break;
      case 'socket':
        await runSocket(parsed);
        break;

      // Process Manager commands (dynamic imports)
      case 'start': {
        const { runStart } = await import('./commands/start.js');
        await runStart(parsed);
        break;
      }
      case 'stop': {
        const { runStop } = await import('./commands/stop.js');
        await runStop(parsed);
        break;
      }
      case 'restart': {
        const { runRestart } = await import('./commands/restart.js');
        await runRestart(parsed);
        break;
      }
      case 'status': {
        const { runStatus } = await import('./commands/status.js');
        await runStatus(parsed);
        break;
      }
      case 'list': {
        const { runList } = await import('./commands/list.js');
        await runList(parsed);
        break;
      }
      case 'logs': {
        const { runLogs } = await import('./commands/logs.js');
        await runLogs(parsed);
        break;
      }
      case 'service': {
        const { runService } = await import('./commands/service.js');
        await runService(parsed);
        break;
      }

      // Package Manager commands (dynamic imports)
      case 'install': {
        const { runInstall } = await import('./commands/install/index.js');
        await runInstall(parsed);
        break;
      }
      case 'uninstall': {
        const { runUninstall } = await import('./commands/uninstall.js');
        await runUninstall(parsed);
        break;
      }
      case 'configure': {
        const { runConfigure } = await import('./commands/configure.js');
        await runConfigure(parsed);
        break;
      }

      case 'help':
        showHelp();
        break;
      default:
        console.error(c('red', `Unknown command: ${cmd}`));
        showHelp();
        process.exitCode = 1;
    }
  } catch (err: unknown) {
    console.error('\n' + c('red', err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  }
}

main();

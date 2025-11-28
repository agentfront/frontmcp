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

function showHelp(): void {
  console.log(`
${c('bold', 'frontmcp')} — FrontMCP command line interface

${c('bold', 'Usage')}
  frontmcp <command> [options]

${c('bold', 'Commands')}
  dev                 Start in development mode (tsx --watch <entry> + async type-check)
  build               Compile entry with TypeScript (tsc)
  test                Run E2E tests with auto-injected Jest configuration
  init                Create or fix a tsconfig.json suitable for FrontMCP
  doctor              Check Node/npm versions and tsconfig requirements
  inspector           Launch MCP Inspector (npx @modelcontextprotocol/inspector)
  create <name>       Scaffold a new FrontMCP project in ./<name>
  template <type>     Scaffold a template by type (e.g., "3rd-party-integration")
  help                Show this help message

${c('bold', 'Options')}
  -o, --out-dir <dir>  Output directory (default: ./dist)
  -e, --entry <path>   Manually specify entry file path

${c('bold', 'Test Options')}
  -i, --runInBand      Run tests sequentially (recommended for E2E)
  -w, --watch          Run tests in watch mode
  -v, --verbose        Show verbose test output
  -t, --timeout <ms>   Set test timeout (default: 60000ms)

${c('bold', 'Examples')}
  frontmcp dev
  frontmcp build --out-dir build
  frontmcp test --runInBand
  frontmcp init
  frontmcp doctor
  frontmcp inspector
  npx frontmcp create my-mcp
  npx frontmcp template marketplace-3rd-tools
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
        await runCreate(projectName);
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

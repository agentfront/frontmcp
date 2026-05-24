/**
 * `frontmcp eject-mcp-config <client>` (issue #400).
 *
 * Reads `clients.<client>` from the resolved `frontmcp.config` and prints a
 * ready-to-paste MCP client snippet to stdout. Supported clients:
 * `claude-code`, `claude-desktop`, `cursor`, `windsurf`, `vscode`.
 */

import * as path from 'path';

import type { Command } from 'commander';

import { writeFile } from '@frontmcp/utils';

import { resolveConfig, type McpClientName } from '../../config';
import { c } from '../../core/colors';
import { emitClientSnippet } from './mcp-client';

const SUPPORTED_CLIENTS: McpClientName[] = ['claude-code', 'claude-desktop', 'cursor', 'windsurf', 'vscode'];

export function registerEjectCommands(program: Command): void {
  program
    .command('eject-mcp-config <client>')
    .description(`Emit a ready-to-paste MCP client snippet. Supported: ${SUPPORTED_CLIENTS.join(', ')}`)
    .option('-o, --out <path>', 'Write the snippet to a file instead of stdout')
    .option('--dry-run', 'When --out is set, print what would be written instead of writing')
    .action(async (client: string, opts: { out?: string; dryRun?: boolean }) => {
      if (!SUPPORTED_CLIENTS.includes(client as McpClientName)) {
        console.error(c('red', `Unknown client "${client}".`));
        console.error(`Supported: ${SUPPORTED_CLIENTS.join(', ')}`);
        process.exit(2);
      }

      const topLevelOpts = program.opts() as { config?: string };
      const resolved = await resolveConfig({
        cwd: process.cwd(),
        mode: 'build:ship',
        configPath: topLevelOpts.config,
      });

      if (!resolved.config) {
        console.error(c('red', 'No frontmcp.config found.'));
        console.error('Create one with `frontmcp create` or pass --config <path>.');
        process.exit(1);
      }

      const snippet = emitClientSnippet(client as McpClientName, resolved.config);

      if (opts.out) {
        const target = path.isAbsolute(opts.out) ? opts.out : path.resolve(process.cwd(), opts.out);
        if (opts.dryRun) {
          console.log(c('cyan', `[dry-run] would write ${target}:\n`));
          console.log(snippet);
          return;
        }
        await writeFile(target, snippet);
        console.log(c('green', `✓ Wrote ${target}`));
        return;
      }

      console.log(snippet);
    });
}

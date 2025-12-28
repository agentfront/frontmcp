/**
 * Graph command - Visualize MCP server structure.
 *
 * Usage:
 *   frontmcp graph                    # Start graph visualization server
 *   frontmcp graph --open             # Open browser automatically
 *   frontmcp graph --json             # Export as JSON to stdout
 *   frontmcp graph --json graph.json  # Export to file
 *   frontmcp graph --port 3000        # Use custom port
 */

import * as path from 'path';
import type { ParsedArgs } from '../args';
import { c } from '../colors';
import { resolveEntry } from '../utils/fs';
import { loadMcpForGraph } from '../graph/loader';
import { exportGraphJson } from '../graph/json-exporter';
import { startGraphServer } from '../graph/server';

/**
 * Run the graph command.
 */
export async function runGraph(opts: ParsedArgs): Promise<void> {
  const cwd = process.cwd();

  console.log(`${c('cyan', '[graph]')} resolving entry file...`);

  // Resolve the entry file
  const entryPath = await resolveEntry(cwd, opts.entry);
  if (!entryPath) {
    console.error(`${c('red', 'Error:')} Could not find entry file.`);
    console.error('');
    console.error('Please ensure you have one of the following:');
    console.error('  - A "main" field in package.json pointing to your entry');
    console.error('  - A src/main.ts file');
    console.error('  - Specify entry with --entry <path>');
    process.exit(1);
  }

  const relativeEntry = path.relative(cwd, entryPath);
  console.log(`${c('cyan', '[graph]')} using entry: ${relativeEntry}`);
  console.log(`${c('cyan', '[graph]')} loading MCP server...`);

  try {
    // Load the MCP server and extract graph data
    const graphData = await loadMcpForGraph(entryPath);

    console.log(
      `${c('green', '✓')} Loaded ${graphData.metadata.nodeCount} nodes, ${graphData.metadata.edgeCount} edges`,
    );

    // Handle JSON export
    if (opts.json !== undefined) {
      const outputPath = typeof opts.json === 'string' ? opts.json : undefined;
      await exportGraphJson(graphData, outputPath);
      return;
    }

    // Start the dev server
    const port = opts.port ?? 4200;
    await startGraphServer(graphData, {
      port,
      open: opts.open ?? false,
    });
  } catch (error) {
    console.error(`${c('red', 'Error:')} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

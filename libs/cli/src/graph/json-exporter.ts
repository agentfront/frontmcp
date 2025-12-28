/**
 * JSON exporter for graph data.
 */

import * as fs from 'fs/promises';
import { c } from '../colors';
import type { GraphData } from './types';

/**
 * Export graph data as JSON.
 * @param data The graph data to export
 * @param outputPath Optional file path. If not provided, outputs to stdout.
 */
export async function exportGraphJson(data: GraphData, outputPath?: string): Promise<void> {
  const json = JSON.stringify(data, null, 2);

  if (outputPath) {
    await fs.writeFile(outputPath, json, 'utf-8');
    console.log(`${c('green', '✓')} Exported graph to ${outputPath}`);
    console.log(`  Nodes: ${data.metadata.nodeCount}`);
    console.log(`  Edges: ${data.metadata.edgeCount}`);
  } else {
    console.log(json);
  }
}

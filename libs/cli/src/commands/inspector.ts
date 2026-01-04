import { c } from '../colors';
import { runCmd } from '@frontmcp/utils';

export async function runInspector(): Promise<void> {
  console.log(`${c('cyan', '[inspector]')} launching MCP Inspector...`);
  await runCmd('npx', ['-y', '@modelcontextprotocol/inspector']);
}

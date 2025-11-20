import { c } from '../colors';
import { runCmd } from '../utils/fs';

export async function runInspector(): Promise<void> {
  console.log(`${c('cyan', '[inspector]')} launching MCP Inspector...`);
  await runCmd('npx', ['-y', '@modelcontextprotocol/inspector']);
}

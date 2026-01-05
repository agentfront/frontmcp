import { App } from '@frontmcp/sdk';
import { RememberPlugin } from '@frontmcp/plugins/remember';
import RememberValueTool from './tools/remember-value.tool';
import RecallValueTool from './tools/recall-value.tool';
import ForgetValueTool from './tools/forget-value.tool';
import ListMemoriesTool from './tools/list-memories.tool';
import CheckMemoryTool from './tools/check-memory.tool';
import MemoryStatsResource from './resources/memory-stats.resource';
import MemorySummaryPrompt from './prompts/memory-summary.prompt';

@App({
  name: 'memory',
  plugins: [
    RememberPlugin.init({
      type: 'memory',
      encryption: { enabled: false }, // Disable encryption for easier testing
    }),
  ],
  tools: [RememberValueTool, RecallValueTool, ForgetValueTool, ListMemoriesTool, CheckMemoryTool],
  resources: [MemoryStatsResource],
  prompts: [MemorySummaryPrompt],
})
export class MemoryApp {}

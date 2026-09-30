import { RememberPlugin } from '@frontmcp/plugin-remember';
import { App } from '@frontmcp/sdk';

import MemorySummaryPrompt from './prompts/memory-summary.prompt';
import MemoryStatsResource from './resources/memory-stats.resource';
import CheckMemoryTool from './tools/check-memory.tool';
import ForgetValueTool from './tools/forget-value.tool';
import ListMemoriesTool from './tools/list-memories.tool';
import RecallValueTool from './tools/recall-value.tool';
import RememberValueTool from './tools/remember-value.tool';

@App({
  name: 'memory',
  plugins: [
    RememberPlugin.init({
      type: 'memory',
      encryption: { enabled: false }, // Disable encryption for easier testing
      tools: { enabled: true, prefix: 'llm_', allowedScopes: ['session', 'user'] },
    }),
  ],
  tools: [RememberValueTool, RecallValueTool, ForgetValueTool, ListMemoriesTool, CheckMemoryTool],
  resources: [MemoryStatsResource],
  prompts: [MemorySummaryPrompt],
})
export class MemoryApp {}

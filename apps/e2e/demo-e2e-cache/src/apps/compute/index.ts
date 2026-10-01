import { App } from '@frontmcp/sdk';
import { CachePlugin } from '@frontmcp/plugins';
import ExpensiveOperationTool from './tools/expensive-operation.tool';
import FlakyOperationTool from './tools/flaky-operation.tool';
import NonCachedTool from './tools/non-cached.tool';
import GetCacheStatsTool from './tools/get-cache-stats.tool';
import ResetStatsTool from './tools/reset-stats.tool';
import CacheStatsResource from './resources/cache-stats.resource';
import CacheReportPrompt from './prompts/cache-report.prompt';

@App({
  name: 'compute',
  plugins: [
    CachePlugin.init({
      type: 'memory',
      defaultTTL: 30, // 30 second default TTL for testing
      bypassHeader: 'x-frontmcp-no-cache', // a renamed bypass header (must start with x-frontmcp-)
    }),
  ],
  tools: [ExpensiveOperationTool, NonCachedTool, FlakyOperationTool, GetCacheStatsTool, ResetStatsTool],
  resources: [CacheStatsResource],
  prompts: [CacheReportPrompt],
})
export class ComputeApp {}

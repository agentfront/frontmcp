import { CodeCallPlugin } from '@frontmcp/plugins';
import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';

import DocsMeasureTool from './apps/crm/tools/docs-measure.tool';
import DocsReadTool from './apps/crm/tools/docs-read.tool';
import UsersListTool from './apps/crm/tools/users-list.tool';

const port = parseInt(process.env['PORT'] ?? '3108', 10);

/** CodeCall with keep and recall on a short TTL, the sidecar on, and a 1 MiB memory limit in the interpreter. */
@App({
  name: 'CRM',
  plugins: [
    CodeCallPlugin.init({
      mode: 'codecall_only',
      vm: { preset: 'secure', runtime: 'interpreter', timeoutMs: 20000, memoryLimitBytes: 1024 * 1024 },
      sidecar: { enabled: true, extractionThreshold: 64 * 1024 },
      keep: { ttlSeconds: 5, maxBytes: 8 * 1024 * 1024, storage: { type: 'memory' } },
    }),
  ],
  tools: [UsersListTool, DocsReadTool, DocsMeasureTool],
})
class CrmWithKeepApp {}

@FrontMcp({
  info: { name: 'Demo E2E CodeCall (keep)', version: '0.1.0' },
  apps: [CrmWithKeepApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}

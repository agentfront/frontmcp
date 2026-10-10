import { App } from '@frontmcp/sdk';

import AuditPlugin from './plugins/audit.plugin';
import AuditSummaryPrompt from './prompts/audit-summary.prompt';
import AuditLogResource from './resources/audit-log.resource';
import AuditedTool from './tools/audited.tool';
import ClearAuditLogTool from './tools/clear-audit-log.tool';
import GetAuditLogTool from './tools/get-audit-log.tool';
import { PlainEchoTool, StaticGuardedEchoTool } from './tools/static-guarded.tool';

@App({
  name: 'audit',
  plugins: [AuditPlugin],
  tools: [AuditedTool, GetAuditLogTool, ClearAuditLogTool, StaticGuardedEchoTool, PlainEchoTool],
  resources: [AuditLogResource],
  prompts: [AuditSummaryPrompt],
})
export class AuditApp {}

import { App } from '@frontmcp/sdk';
import AuditPlugin from './plugins/audit.plugin';
import AuditedTool from './tools/audited.tool';
import GetAuditLogTool from './tools/get-audit-log.tool';
import ClearAuditLogTool from './tools/clear-audit-log.tool';
import AuditLogResource from './resources/audit-log.resource';
import AuditSummaryPrompt from './prompts/audit-summary.prompt';

@App({
  name: 'audit',
  plugins: [AuditPlugin],
  tools: [AuditedTool, GetAuditLogTool, ClearAuditLogTool],
  resources: [AuditLogResource],
  prompts: [AuditSummaryPrompt],
})
export class AuditApp {}

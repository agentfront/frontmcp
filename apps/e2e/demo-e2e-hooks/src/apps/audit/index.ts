import { App } from '@frontmcp/sdk';

import AuditPlugin from './plugins/audit.plugin';
import FinallyRecorderPlugin from './plugins/finally-recorder.plugin';
import RequestProbePlugin from './plugins/request-probe.plugin';
import AuditSummaryPrompt from './prompts/audit-summary.prompt';
import AuditLogResource from './resources/audit-log.resource';
import AuditedTool from './tools/audited.tool';
import ClearAuditLogTool from './tools/clear-audit-log.tool';
import FailingExecuteTool from './tools/failing-execute.tool';
import GetAuditLogTool from './tools/get-audit-log.tool';
import GetFinallyLogTool from './tools/get-finally-log.tool';
import ProbeRequestTool from './tools/probe-request.tool';
import RefusedAnswerTool from './tools/refused-answer.tool';
import { PlainEchoTool, StaticGuardedEchoTool } from './tools/static-guarded.tool';

@App({
  name: 'audit',
  plugins: [AuditPlugin, FinallyRecorderPlugin, RequestProbePlugin],
  tools: [
    AuditedTool,
    GetAuditLogTool,
    ClearAuditLogTool,
    StaticGuardedEchoTool,
    PlainEchoTool,
    RefusedAnswerTool,
    FailingExecuteTool,
    GetFinallyLogTool,
    ProbeRequestTool,
  ],
  resources: [AuditLogResource],
  prompts: [AuditSummaryPrompt],
})
export class AuditApp {}

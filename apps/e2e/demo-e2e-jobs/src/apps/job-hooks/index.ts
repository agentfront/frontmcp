import { App } from '@frontmcp/sdk';

import { AuditedFlowWorkflow, AuditedGreetJob, FlakyCountJob } from './jobs/audited.jobs';
import JobAuditPlugin from './plugins/job-audit.plugin';
import { ClearJobAuditTool, GetJobAuditTool } from './tools/job-audit.tools';

/** Jobs whose every attempt a plugin hook on `jobs:execute-job` audits (#700). */
@App({
  name: 'JobHooks',
  description: 'Job attempts audited through the jobs:execute-job flow',
  plugins: [JobAuditPlugin],
  jobs: [AuditedGreetJob, FlakyCountJob],
  workflows: [AuditedFlowWorkflow],
  tools: [GetJobAuditTool, ClearJobAuditTool],
})
export class JobHooksApp {}

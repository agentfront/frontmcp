import { App } from '@frontmcp/sdk';

import ApproveJobTool from './tools/approve-job.tool';
import SlowJobTool from './tools/slow-job.tool';

/** Fixture app for the `io.modelcontextprotocol/tasks` extension (SEP-2663). */
@App({
  name: 'tasks',
  description: 'Tasks extension conformance fixture',
  tools: [SlowJobTool, ApproveJobTool],
})
export class TasksApp {}

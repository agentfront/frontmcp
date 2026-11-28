import { App } from '@frontmcp/sdk';

import { FlowAccessPlugin } from '../flow-access/flow-access.plugin';
import PrioritizeTasksPrompt from './prompts/prioritize-tasks.prompt';
import TasksListResource from './resources/tasks-list.resource';
import CreateTaskTool from './tools/create-task.tool';
import ListTasksTool from './tools/list-tasks.tool';
import WhoAmITool from './tools/whoami.tool';

@App({
  name: 'Tasks',
  description: 'Task management application for E2E testing with transparent auth',
  tools: [CreateTaskTool, ListTasksTool, WhoAmITool],
  resources: [TasksListResource],
  prompts: [PrioritizeTasksPrompt],
  plugins: [FlowAccessPlugin],
})
export class TasksApp {}

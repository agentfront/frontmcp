import { App } from '@frontmcp/sdk';

import PrioritizeTasksPrompt from './prompts/prioritize-tasks.prompt';
import TasksListResource from './resources/tasks-list.resource';
import CompleteTaskTool from './tools/complete-task.tool';
import CreateTaskTool from './tools/create-task.tool';
import ListTasksTool from './tools/list-tasks.tool';

@App({
  name: 'Tasks',
  description: 'Task management application',
  tools: [CreateTaskTool, CompleteTaskTool, ListTasksTool],
  resources: [TasksListResource],
  prompts: [PrioritizeTasksPrompt],
})
export class TasksApp {}

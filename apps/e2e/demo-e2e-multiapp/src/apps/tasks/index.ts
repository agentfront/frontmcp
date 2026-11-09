import { App } from '@frontmcp/sdk';

import PrioritizeTasksPrompt from './prompts/prioritize-tasks.prompt';
import TasksAllResource from './resources/tasks-all.resource';
import CreateTaskTool from './tools/create-task.tool';
import ListTasksTool from './tools/list-tasks.tool';

@App({
  name: 'tasks',
  description: 'Task management app',
  tools: [CreateTaskTool, ListTasksTool],
  resources: [TasksAllResource],
  prompts: [PrioritizeTasksPrompt],
})
export class TasksApp {}

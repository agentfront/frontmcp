import { App } from '@frontmcp/sdk';

import CreateTaskTool from './tools/create-task.tool';
import ListTasksTool from './tools/list-tasks.tool';

import TasksAllResource from './resources/tasks-all.resource';

import PrioritizeTasksPrompt from './prompts/prioritize-tasks.prompt';

@App({
  name: 'tasks',
  description: 'Task management app',
  tools: [CreateTaskTool, ListTasksTool],
  resources: [TasksAllResource],
  prompts: [PrioritizeTasksPrompt],
})
export class TasksApp {}

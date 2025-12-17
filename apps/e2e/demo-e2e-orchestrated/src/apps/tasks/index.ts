import { App } from '@frontmcp/sdk';
import CreateTaskTool from './tools/create-task.tool';
import CompleteTaskTool from './tools/complete-task.tool';
import ListTasksTool from './tools/list-tasks.tool';
import TasksListResource from './resources/tasks-list.resource';
import PrioritizeTasksPrompt from './prompts/prioritize-tasks.prompt';

@App({
  name: 'Tasks',
  description: 'Task management application',
  tools: [CreateTaskTool, CompleteTaskTool, ListTasksTool],
  resources: [TasksListResource],
  prompts: [PrioritizeTasksPrompt],
})
export class TasksApp {}

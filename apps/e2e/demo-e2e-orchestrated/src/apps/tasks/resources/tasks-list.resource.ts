import { Resource, ResourceContext } from '@frontmcp/sdk';
import { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

@Resource({
  name: 'tasks-list',
  uri: 'tasks://all',
  description: 'List of all tasks',
  mimeType: 'application/json',
})
export default class TasksListResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    const data = {
      tasks: [
        { id: 'task-1', title: 'Review PR', priority: 'high', completed: false },
        { id: 'task-2', title: 'Write tests', priority: 'medium', completed: true },
      ],
    };

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }
}

import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { taskStore } from '../data/task.store';

@Prompt({
  name: 'prioritize-tasks',
  description: 'Generate a prioritized task list',
  arguments: [],
})
export default class PrioritizeTasksPrompt extends PromptContext {
  async execute(_args: Record<string, string>): Promise<GetPromptResult> {
    const store = taskStore;
    const tasks = store.getAll();

    let content: string;

    if (tasks.length === 0) {
      content = `# Task Prioritization

No tasks found. Create some tasks using the \`create-task\` tool.`;
    } else {
      const highPriority = store.getByPriority('high');
      const mediumPriority = store.getByPriority('medium');
      const lowPriority = store.getByPriority('low');

      const formatTasks = (taskList: typeof tasks) =>
        taskList.map((t) => `- [ ] **${t.title}**: ${t.description || 'No description'}`).join('\n');

      content = `# Task Prioritization

**Total Tasks**: ${tasks.length}
**App**: tasks

## 🔴 High Priority (${highPriority.length})
${highPriority.length > 0 ? formatTasks(highPriority) : 'None'}

## 🟡 Medium Priority (${mediumPriority.length})
${mediumPriority.length > 0 ? formatTasks(mediumPriority) : 'None'}

## 🟢 Low Priority (${lowPriority.length})
${lowPriority.length > 0 ? formatTasks(lowPriority) : 'None'}`;
    }

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: content,
          },
        },
      ],
      description: `Task prioritization (${tasks.length} tasks)`,
    };
  }
}

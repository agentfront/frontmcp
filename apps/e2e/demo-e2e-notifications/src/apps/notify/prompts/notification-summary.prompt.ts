import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { notificationLogStore, NotificationLogEntry } from '../data/notification-log.store';

@Prompt({
  name: 'notification-summary',
  description: 'Generate a summary of notifications',
  arguments: [
    {
      name: 'type',
      description:
        'Filter by notification type (resource_change, progress, message, tools_changed, prompts_changed, all)',
      required: false,
    },
  ],
})
export default class NotificationSummaryPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const filterType = args['type'] || 'all';
    const entries =
      filterType === 'all'
        ? notificationLogStore.getAll()
        : notificationLogStore.getByType(filterType as NotificationLogEntry['type']);

    let content: string;

    if (entries.length === 0) {
      content = `# Notification Summary

No notifications found${filterType !== 'all' ? ` for type: ${filterType}` : ''}.

## Available Notification Types
- **resource_change**: Resource list changed notifications
- **progress**: Progress/log notifications
- **message**: General message notifications
- **tools_changed**: Tool list changed notifications
- **prompts_changed**: Prompt list changed notifications`;
    } else {
      const typeCount: Record<string, number> = {};
      for (const entry of entries) {
        typeCount[entry.type] = (typeCount[entry.type] ?? 0) + 1;
      }

      const typeSummary = Object.entries(typeCount)
        .map(([type, count]) => `- **${type}**: ${count}`)
        .join('\n');

      const recentEntries = entries
        .slice(-5)
        .reverse()
        .map((e) => `- [${new Date(e.timestamp).toISOString()}] ${e.type}: ${JSON.stringify(e.details)}`)
        .join('\n');

      content = `# Notification Summary

## Statistics
- **Total notifications**: ${entries.length}
- **Filter**: ${filterType}

## By Type
${typeSummary}

## Recent Notifications (last 5)
${recentEntries}`;
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
      description: `Notification summary (${entries.length} entries)`,
    };
  }
}

import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { eventStore } from '../data/event.store';

@Prompt({
  name: 'schedule-overview',
  description: 'Generate a schedule overview',
  arguments: [],
})
export default class ScheduleOverviewPrompt extends PromptContext {
  async execute(_args: Record<string, string>): Promise<GetPromptResult> {
    const store = eventStore;
    const events = store.getAll();

    let content: string;

    if (events.length === 0) {
      content = `# Schedule Overview

No events scheduled. Create events using the \`create-event\` tool.`;
    } else {
      const upcoming = store.getUpcoming();

      const formatEvent = (e: (typeof events)[0]) => {
        const start = new Date(e.startTime).toISOString();
        const end = new Date(e.endTime).toISOString();
        const location = e.location ? ` @ ${e.location}` : '';
        return `- **${e.title}**${location}
  ${start} - ${end}
  ${e.description || 'No description'}`;
      };

      content = `# Schedule Overview

**Total Events**: ${events.length}
**Upcoming Events**: ${upcoming.length}
**App**: calendar

## Upcoming Events
${upcoming.length > 0 ? upcoming.map(formatEvent).join('\n\n') : 'No upcoming events'}

## All Events
${events.map(formatEvent).join('\n\n')}`;
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
      description: `Schedule overview (${events.length} events)`,
    };
  }
}

import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

@Prompt({
  name: 'analyze-user-activity',
  description: 'Analyze user activity patterns in the CRM',
  arguments: [
    {
      name: 'userId',
      description: 'Specific user to analyze',
      required: false,
    },
  ],
})
export default class AnalyzeUserActivityPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const stats = crmStore.getActivityStats();
    const activities = crmStore.listActivities(args.userId);

    const activitiesList = activities.map((a) => `- [${a.type}] ${a.description} (${a.timestamp})`).join('\n');

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please analyze the following CRM activity data:

Total activities: ${stats.total}
Activities by type: ${JSON.stringify(stats.byType)}
Activities by user: ${JSON.stringify(stats.byUser)}

Recent activities:
${activitiesList || 'No activities found'}

Provide insights on engagement patterns and recommendations.`,
          },
        },
      ],
      description: `Analyze ${activities.length} activities`,
    };
  }
}

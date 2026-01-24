import { skill } from '@frontmcp/sdk';

/**
 * Notify Team Skill - demonstrates skill with simple tool references
 */
export const NotifyTeamSkill = skill({
  name: 'notify-team',
  description: 'Notify team members via Slack about important updates',
  instructions: `
## Team Notification Process

1. Compose a clear, concise message
2. Use slack_notify to send the message to the appropriate channel
3. Confirm delivery

### Best Practices
- Keep messages actionable
- Include relevant links
- Tag appropriate team members
  `,
  tools: ['slack_notify'],
  tags: ['communication', 'slack'],
});

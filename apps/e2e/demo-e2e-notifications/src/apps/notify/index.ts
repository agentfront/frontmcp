import { App } from '@frontmcp/sdk';

import NotificationSummaryPrompt from './prompts/notification-summary.prompt';
import NotificationLogResource from './resources/notification-log.resource';
import LongRunningTaskTool from './tools/long-running-task.tool';
import TestNotifyMethodTool from './tools/test-notify-method.tool';
import TestProgressMethodTool from './tools/test-progress-method.tool';
import TriggerProgressTool from './tools/trigger-progress.tool';
import TriggerResourceChangeTool from './tools/trigger-resource-change.tool';

@App({
  name: 'notify',
  description: 'Notification system demo',
  tools: [
    TriggerResourceChangeTool,
    TriggerProgressTool,
    LongRunningTaskTool,
    TestNotifyMethodTool,
    TestProgressMethodTool,
  ],
  resources: [NotificationLogResource],
  prompts: [NotificationSummaryPrompt],
})
export class NotifyApp {}

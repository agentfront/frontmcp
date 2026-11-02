import { App } from '@frontmcp/sdk';

import ListQueuesTool from './tools/list-queues.tool';
import ReviewListTool from './tools/review-list.tool';

@App({
  name: 'review',
  description: 'Code review app',
  tools: [ReviewListTool, ListQueuesTool],
})
export class ReviewApp {}

import { Tool, ToolContext } from '@frontmcp/sdk';

import { reviewsEnabled } from '../reviews.signal';

@Tool({
  name: 'review_list',
  description: 'Lists the open reviews; on while the reviews feature is on',
  inputSchema: {},
  enabled: reviewsEnabled,
})
export default class ReviewListTool extends ToolContext {
  async execute() {
    return { reviews: ['first review'] };
  }
}

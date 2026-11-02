import 'reflect-metadata';

import { App, FrontMcp, PublicMcpError, refused, Tool, ToolContext, z, type ErrorRemedy } from '@frontmcp/sdk';

const turnOnReviews: ErrorRemedy = {
  say: 'Turn on Reviews in Settings',
  tool: 'settings_set',
  args: { feature: 'reviews' },
};

@Tool({ name: 'review_list', aliases: ['review.list'], inputSchema: { enabled: z.boolean() } })
export class ReviewListTool extends ToolContext {
  async execute(input: { enabled: boolean }) {
    if (!input.enabled) {
      this.fail(refused('Reviews are off', { code: 'FEATURE_OFF', status: 403, remedy: turnOnReviews }));
    }
    return { reviews: 0 };
  }
}

export const setupRequired = new PublicMcpError('Run setup first', 'SETUP_REQUIRED', 412, undefined, {
  say: 'Run setup',
});

// @ts-expect-error a remedy says what to do
export const silentRemedy: ErrorRemedy = { tool: 'settings_set' };

// @ts-expect-error aliases is a list of names
@Tool({ name: 'review_count', aliases: 'review.count', inputSchema: {} })
export class ReviewCountTool extends ToolContext {
  async execute() {
    return 0;
  }
}

@App({ name: 'Review', tools: [ReviewListTool] })
export class ReviewApp {}

@FrontMcp({ info: { name: 'reviews', version: '1.0.0' }, apps: [ReviewApp] })
export class ReviewServer {}

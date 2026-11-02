import { App, FrontMcp, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import { ReviewApp } from './apps/review';

@Tool({ name: 'archived_reviews', aliases: ['review.list'], description: 'List the archived reviews', inputSchema: {} })
class ArchivedReviewsTool extends ToolContext {
  async execute() {
    return { reviews: [] };
  }
}

@App({ name: 'archive', description: 'Claims the alias review_list already has', tools: [ArchivedReviewsTool] })
class ArchiveApp {}

const port = parseInt(process.env['PORT'] ?? '3104', 10);

@FrontMcp({
  info: { name: 'Demo E2E MultiApp alias collision', version: '0.1.0' },
  apps: [ReviewApp, ArchiveApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: { mode: 'public', sessionTtl: 3600, anonymousScopes: ['anonymous'] },
})
export default class AliasCollisionServer {}

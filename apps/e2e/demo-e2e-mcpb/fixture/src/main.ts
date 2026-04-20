import 'reflect-metadata';

import { FrontMcp, LogLevel } from '@frontmcp/sdk';

import { McpbDemoApp } from './apps/mcpb-demo';

@FrontMcp({
  info: { name: 'mcpb-demo', version: '1.2.3' },
  apps: [McpbDemoApp],
  logging: { level: LogLevel.Warn, enableConsole: false },
  auth: { mode: 'public' as const },
  serve: false,
})
export default class McpbDemoServer {}

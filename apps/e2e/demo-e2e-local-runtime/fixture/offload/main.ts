import { App, FrontMcp, LogLevel } from '@frontmcp/sdk';

import { CrunchTool } from './crunch.tool';
import { HeavyReport, InlineReport, StuckReport } from './reports.resource';

const port = parseInt(process.env['PORT'] ?? '3190', 10);

@App({ name: 'reports', resources: [HeavyReport, StuckReport, InlineReport], tools: [CrunchTool] })
class ReportsApp {}

@FrontMcp({
  info: { name: 'Demo E2E Offload', version: '0.1.0' },
  apps: [ReportsApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  offload: { maxWorkers: 1 },
})
export default class Server {}

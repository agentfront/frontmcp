import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { ElicitationDemoApp } from './apps/elicitation-demo';

const port = parseInt(process.env['PORT'] ?? '3122', 10);

@FrontMcp({
  info: { name: 'Demo E2E Elicitation', version: '0.1.0' },
  apps: [ElicitationDemoApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'public',
  },
})
export default class Server {}

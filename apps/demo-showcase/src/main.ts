import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import NotesApp from './apps/notes';

// Get port from env variable (set by test runner) or default to 3010
const port = parseInt(process.env['PORT'] ?? '3010', 10);

@FrontMcp({
  info: { name: 'Demo Showcase', version: '1.0.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Info },
  http: { port },
  auth: {
    type: 'local',
    id: 'local',
    name: 'Local Auth',
    allowAnonymous: true,
  },
})
export default class Server {}

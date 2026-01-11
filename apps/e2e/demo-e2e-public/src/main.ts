import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { NotesApp } from './apps/notes';

const port = parseInt(process.env['PORT'] ?? '3010', 10);

@FrontMcp({
  info: { name: 'Demo E2E Public', version: '0.1.0' },
  apps: [NotesApp],
  logging: { level: LogLevel.Verbose },
  http: { port },
  auth: {
    mode: 'public',
  },
})
export default class Server {}

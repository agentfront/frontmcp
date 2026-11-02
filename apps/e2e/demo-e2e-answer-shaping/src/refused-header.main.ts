import { FrontMcp } from '@frontmcp/sdk';

import { ReportsApp } from './apps/reports';

/** Never starts: `http.forwardHeaders` names `authorization`, which FrontMCP refuses at boot. */
@FrontMcp({
  info: { name: 'Demo E2E Answer Shaping (refused header)', version: '0.1.0' },
  apps: [ReportsApp],
  http: { port: 0, forwardHeaders: ['x-acme-*', 'authorization'] },
  auth: { mode: 'public' },
})
export default class RefusedHeaderServer {}

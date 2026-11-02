import { FrontMcp } from '@frontmcp/sdk';

import { serverConfig } from './config';

const port = parseInt(process.env['PORT'] ?? '3118', 10);

@FrontMcp({
  ...serverConfig,
  http: { port },
})
export default class Server {}

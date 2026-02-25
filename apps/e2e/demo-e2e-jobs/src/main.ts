import { FrontMcp } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

const rawPort = parseInt(process.env['PORT'] ?? '3118', 10);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3118;

@FrontMcp({
  ...serverConfig,
  http: { port },
})
export default class Server {}

export { serverConfig } from './config.js';

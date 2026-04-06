import 'reflect-metadata';
import { FrontMcp } from '@frontmcp/sdk';
import { serverConfig } from './config.js';

@FrontMcp({
  ...serverConfig,
  http: { port: Number(process.env['PORT']) || 3199 },
})
class StdioTransportE2EServer {}

export { StdioTransportE2EServer };
export { serverConfig };

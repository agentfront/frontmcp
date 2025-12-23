// file: libs/sdk/src/server/adapters/index.ts
/**
 * Server host adapters for different environments.
 */

// Base adapter interface
export { HostServerAdapter } from './base.host.adapter';

// HTTP server adapters (Node.js only)
export { ExpressHostAdapter } from './express.host.adapter';

// NoOp adapter (browser/serverless)
export { NoOpHostAdapter } from './noop.host.adapter';

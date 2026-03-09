/**
 * @file server/index.ts
 * @description Test server management exports
 */

export { TestServer } from './test-server';
export type { TestServerOptions, TestServerInfo } from './test-server';

// Port registry exports
export {
  reservePort,
  getProjectPort,
  getProjectPorts,
  getPortRange,
  releaseAllPorts,
  getReservedPorts,
  E2E_PORT_RANGES,
} from './port-registry';
export type { E2EProject } from './port-registry';

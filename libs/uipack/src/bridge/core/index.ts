/**
 * Bridge Core Module
 *
 * Core infrastructure for the FrontMcpBridge system.
 *
 * @packageDocumentation
 */

export { AdapterRegistry, defaultRegistry, registerAdapter, getAdapter, detectAdapter } from './adapter-registry';

export { FrontMcpBridge, createBridge, getGlobalBridge, resetGlobalBridge } from './bridge-factory';

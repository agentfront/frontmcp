import { FrontMcp, LogLevel } from '@frontmcp/sdk';
import { EnvAwareApp } from './apps/env-aware';

const DEFAULT_PORT = 3150;
const parsedPort = Number(process.env['PORT']);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : DEFAULT_PORT;

/**
 * E2E Test Server for Environment Awareness
 *
 * Registers tools, resources, and prompts with various `availableWhen` constraints.
 * The e2e tests verify that only entries matching the current environment are
 * discoverable and executable.
 *
 * Expected visible entries (running in Node.js, standalone, on current OS):
 *   Tools: always_available, current_platform_tool, node_runtime_tool,
 *          standalone_deploy_tool, multi_constraint_tool
 *   Resources: node-info
 *   Prompts: node-debug
 *
 * Expected filtered entries:
 *   Tools: impossible_platform_tool, browser_only_tool, serverless_only_tool,
 *          multi_constraint_fail_tool, hidden_but_available (hidden, not filtered)
 *   Resources: browser-storage
 *   Prompts: edge-prompt
 */
@FrontMcp({
  info: { name: 'Demo E2E Env Awareness', version: '0.1.0' },
  apps: [EnvAwareApp],
  logging: { level: LogLevel.Warn },
  http: { port },
  auth: {
    mode: 'public',
    sessionTtl: 3600,
    anonymousScopes: ['anonymous'],
  },
  transport: {
    protocol: { json: true, legacy: true, strictSession: false },
  },
})
export default class Server {}

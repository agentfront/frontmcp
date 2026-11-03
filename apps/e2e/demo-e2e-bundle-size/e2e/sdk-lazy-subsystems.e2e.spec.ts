/**
 * The SDK's CommonJS build sets up the subsystems a server may never use the first time one of their exports is read,
 * and a public-mode server loads each of its OAuth flows with the first request that reaches it (#950).
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { workspaceRoot } from './helpers/browser-bundle';

type Step = { step: string; initialized: string[] };

const SUBSYSTEM_MODULE = /^libs\/sdk\/src\/(job|workflow|channel|remote-mcp|esm-loader)\//;
// Helpers the startup path itself uses: the decorators parse `Tool.esm()` specifiers, the scope normalizes app entries
const STARTUP_HELPERS = [
  'libs/sdk/src/esm-loader/package-specifier.ts',
  'libs/sdk/src/esm-loader/module-specifiers.ts',
  'libs/sdk/src/job/job.utils.ts',
  'libs/sdk/src/channel/channel.utils.ts',
  'libs/sdk/src/channel/sources/completion-events.ts',
];
const OAUTH_FLOW_MODULE = /^libs\/sdk\/src\/auth\/flows\/oauth\.[a-z-]+\.flow\.ts$/;

function initializedModules(...steps: string[]): Step[] {
  const runner = resolve(__dirname, 'helpers', 'initialized-modules.cjs');
  return JSON.parse(
    execFileSync(process.execPath, [runner, resolve(workspaceRoot, 'libs/sdk/dist/index.js'), ...steps], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
}

describe('the subsystems of the SDK under require()', () => {
  it('are not set up when the SDK loads', () => {
    const [load] = initializedModules();

    expect(load.initialized.length).toBeGreaterThan(0);
    const subsystemModules = load.initialized.filter((source) => SUBSYSTEM_MODULE.test(source));
    expect(subsystemModules.filter((source) => !STARTUP_HELPERS.includes(source))).toEqual([]);
  });

  it.each([
    ['JobRegistry', 'libs/sdk/src/job/job.registry.ts'],
    ['WorkflowRegistry', 'libs/sdk/src/workflow/workflow.registry.ts'],
    ['ChannelRegistry', 'libs/sdk/src/channel/channel.registry.ts'],
    ['McpClientService', 'libs/sdk/src/remote-mcp/mcp-client.service.ts'],
    ['EsmModuleLoader', 'libs/sdk/src/esm-loader/esm-module-loader.ts'],
  ])('are set up when %s is read', (exportName, source) => {
    const [, read] = initializedModules(`read:${exportName}`);

    expect(read.initialized).toContain(source);
  });
});

describe('the OAuth flows of a public-mode server', () => {
  it('load with the first request that reaches each one', () => {
    const [, start, authorize, token] = initializedModules(
      'fetch:',
      'fetch:GET /oauth/authorize',
      'fetch:POST /oauth/token',
    );
    const oauthFlows = (step: Step) => step.initialized.filter((source) => OAUTH_FLOW_MODULE.test(source));

    expect(oauthFlows(start)).toEqual([]);
    expect(oauthFlows(authorize)).toEqual(['libs/sdk/src/auth/flows/oauth.authorize.flow.ts']);
    expect(oauthFlows(token)).toEqual(['libs/sdk/src/auth/flows/oauth.token.flow.ts']);
  });
});

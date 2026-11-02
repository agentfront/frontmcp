/**
 * With the SDK's CommonJS build, a plugin's hooks on the flows of the subsystems it sets up on first use still run:
 * jobs and workflow steps, channel notifications and the channel list, and every OAuth flow of a public-mode server
 * (#950).
 *
 * Needs the packages built: `nx run-many -t build -p sdk plugin-webmcp`.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import { workspaceRoot } from './helpers/browser-bundle';

function flowsTheHooksSaw(): string[] {
  const runner = resolve(__dirname, 'helpers', 'subsystem-hooks.mjs');
  return JSON.parse(
    execFileSync(process.execPath, [runner, resolve(workspaceRoot, 'libs/sdk/dist/index.js')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

describe('hooks on the flows of the subsystems the SDK sets up on first use', () => {
  it('run under require()', () => {
    expect(flowsTheHooksSaw().sort()).toEqual(
      [
        'jobs:execute-job greet',
        'jobs:execute-job greet in greet-twice',
        'channels:send-notification',
        'channels:list',
        'oauth:authorize',
        'oauth:token',
        'oauth:userinfo',
        'oauth:callback',
        'oauth:connect',
        'oauth:register',
        'oauth:provider-callback',
        'oauth:auth-ui-extra',
      ].sort(),
    );
  });
});

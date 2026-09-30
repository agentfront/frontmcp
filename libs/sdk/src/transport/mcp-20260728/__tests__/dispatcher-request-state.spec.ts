/**
 * The dispatcher's log line for a `requestState` it could not verify.
 *
 * Without `VAULT_SECRET`/`JWT_SECRET` every instance signs with its own random
 * key, so a round that lands on another instance is rejected as
 * `bad-signature` and the exchange quietly restarts. The log must say why.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext } from '../../../common';
import { type Scope } from '../../../scope/scope.instance';
import { resetRequestStateKey } from '../request-state';

@Tool({ name: 'confirm_deploy', inputSchema: {} })
class ConfirmDeployTool extends ToolContext {
  async execute() {
    const answer = await this.elicit('Deploy now?', z.object({ confirmed: z.boolean() }));
    return { confirmed: answer.content?.confirmed ?? false };
  }
}

@App({ id: 'deploys', name: 'Deploys', tools: [ConfirmDeployTool] })
class DeploysApp {}

const FORGED_STATE = `${Buffer.from(JSON.stringify({ r: {} }), 'utf8').toString('base64url')}.not-our-signature`;

async function rejectionLogFor(server: TestFetchServer): Promise<Record<string, unknown>> {
  const scope = server.instance.getScopes()[0] as unknown as Scope;
  const warn = jest.spyOn(scope.logger, 'warn');

  await rpc20260728(
    server.handler,
    'tools/call',
    { name: 'confirm_deploy', arguments: {}, requestState: FORGED_STATE },
    { capabilities: { elicitation: { form: {} } } },
  );

  const call = warn.mock.calls.find(([message]) => message === 'mcp-20260728: rejected requestState');
  if (!call) throw new Error('the dispatcher did not log the rejected requestState');
  return call[1] as Record<string, unknown>;
}

describe('dispatch20260728 — rejected requestState log', () => {
  const originalVault = process.env['VAULT_SECRET'];
  const originalJwt = process.env['JWT_SECRET'];

  afterEach(() => {
    if (originalVault === undefined) delete process.env['VAULT_SECRET'];
    else process.env['VAULT_SECRET'] = originalVault;
    if (originalJwt === undefined) delete process.env['JWT_SECRET'];
    else process.env['JWT_SECRET'] = originalJwt;
    resetRequestStateKey();
  });

  it('names VAULT_SECRET when a per-process key rejects the signature', async () => {
    delete process.env['VAULT_SECRET'];
    delete process.env['JWT_SECRET'];
    resetRequestStateKey();
    const server = await createTestFetchServer({
      info: { name: 'request-state-hint', version: '1.0.0' },
      apps: [DeploysApp],
      elicitation: { enabled: true },
    });

    const log = await rejectionLogFor(server);

    expect(log['reason']).toBe('bad-signature');
    expect(log['method']).toBe('tools/call');
    expect(String(log['hint'])).toContain('VAULT_SECRET');
  });

  it('adds no hint when the key comes from a shared secret', async () => {
    process.env['VAULT_SECRET'] = 'shared-across-instances';
    resetRequestStateKey();
    const server = await createTestFetchServer({
      info: { name: 'request-state-no-hint', version: '1.0.0' },
      apps: [DeploysApp],
      elicitation: { enabled: true },
    });

    const log = await rejectionLogFor(server);

    expect(log['reason']).toBe('bad-signature');
    expect(log).not.toHaveProperty('hint');
  });
});

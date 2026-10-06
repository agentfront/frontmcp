/**
 * `alwaysPrompt: true` asks for approval on every call (#678).
 *
 * The gate refused every call of such a tool, approved or not, so a tool documented as "prompt
 * every time, even if previously approved" could never run at all. Each approval now lets exactly
 * one call through and is used up by it: the next call is refused with `pending` until the caller
 * approves again.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type DirectMcpServer,
} from '@frontmcp/sdk';
import { createMemoryStorage, type RootStorage } from '@frontmcp/utils';

import { ApprovalPlugin, ApprovalRequiredError, ApprovalScope, ApprovalState } from '../index';

const DELETE_ACCOUNT_ID = 'accounts:delete_account';
const PURGE_REPO_ID = 'accounts:purge_repo';
const REPO_CONTEXT = { type: 'repository', identifier: 'acme/api' };
const SESSION_ID = 'session-alice';

let deletions = 0;

@Tool({
  name: 'delete_account',
  inputSchema: {},
  approval: { required: true, riskLevel: 'critical', alwaysPrompt: true },
})
class DeleteAccountTool extends ToolContext {
  async execute() {
    deletions += 1;
    return { deleted: true };
  }
}

@Tool({
  name: 'purge_repo',
  inputSchema: {},
  approval: { required: true, alwaysPrompt: true, preApprovedContexts: [REPO_CONTEXT] },
})
class PurgeRepoTool extends ToolContext {
  async execute() {
    deletions += 1;
    return { purged: true };
  }
}

@Tool({
  name: 'grant',
  inputSchema: { toolId: z.string(), scope: z.enum(['session', 'user', 'time_limited']).optional() },
})
class GrantTool extends ToolContext {
  async execute({ toolId, scope }: { toolId: string; scope?: 'session' | 'user' | 'time_limited' }) {
    if (scope === 'user') await this.approval.grantUserApproval(toolId);
    else if (scope === 'time_limited') await this.approval.grantTimeLimitedApproval(toolId, 60_000);
    else await this.approval.grantSessionApproval(toolId);
    return { granted: toolId };
  }
}

const CALLER: DirectAuthContext = { sessionId: SESSION_ID, user: { sub: 'alice' } };

async function outcome(
  server: DirectMcpServer,
  toolName = 'delete_account',
  authContext = CALLER,
): Promise<'ran' | 'pending' | 'denied' | 'expired'> {
  try {
    await server.callTool(toolName, {}, { authContext });
    return 'ran';
  } catch (error) {
    if (error instanceof ApprovalRequiredError) return error.details.state as 'pending' | 'denied' | 'expired';
    throw error;
  }
}

async function grant(
  server: DirectMcpServer,
  scope?: 'session' | 'user' | 'time_limited',
  toolId = DELETE_ACCOUNT_ID,
): Promise<void> {
  const result = await server.callTool('grant', { toolId, scope }, { authContext: CALLER });
  expect(result.isError).toBeFalsy();
}

describe('ApprovalPlugin — alwaysPrompt (#678)', () => {
  let storage: RootStorage;
  let server: DirectMcpServer;

  beforeEach(async () => {
    deletions = 0;
    storage = createMemoryStorage();
    await storage.connect();

    @App({
      id: 'accounts',
      name: 'Accounts',
      plugins: [ApprovalPlugin.init({ storageInstance: storage })],
      tools: [DeleteAccountTool, PurgeRepoTool, GrantTool],
    })
    class AccountsApp {}

    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-always-prompt', version: '1.0.0' },
      apps: [AccountsApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterEach(async () => {
    await server.dispose();
  });

  it('refuses a call that has not been approved', async () => {
    await expect(outcome(server)).resolves.toBe('pending');
    expect(deletions).toBe(0);
  });

  it('runs the call that follows an approval', async () => {
    await grant(server);

    await expect(outcome(server)).resolves.toBe('ran');
    expect(deletions).toBe(1);
  });

  it('prompts again on the next call: the approval is used up', async () => {
    await grant(server);
    await outcome(server);

    await expect(outcome(server)).resolves.toBe('pending');
    expect(deletions).toBe(1);
  });

  it('runs once per approval', async () => {
    await grant(server);
    await outcome(server);
    await grant(server);

    await expect(outcome(server)).resolves.toBe('ran');
    await expect(outcome(server)).resolves.toBe('pending');
    expect(deletions).toBe(2);
  });

  it.each(['user', 'time_limited'] as const)('uses up a %s approval the same way', async (scope) => {
    await grant(server, scope);

    await expect(outcome(server)).resolves.toBe('ran');
    await expect(outcome(server)).resolves.toBe('pending');
    expect(deletions).toBe(1);
  });

  it('lets only one of two concurrent calls through on one approval', async () => {
    await grant(server);

    const outcomes = await Promise.all([outcome(server), outcome(server)]);

    expect(outcomes.sort()).toEqual(['pending', 'ran']);
    expect(deletions).toBe(1);
  });

  it('asks for an approval per call in a pre-approved context too', async () => {
    const inRepo: DirectAuthContext = { ...CALLER, extra: { approvalContext: REPO_CONTEXT } };

    await expect(outcome(server, 'purge_repo', inRepo)).resolves.toBe('pending');
    await grant(server, undefined, PURGE_REPO_ID);
    await expect(outcome(server, 'purge_repo', inRepo)).resolves.toBe('ran');
    await expect(outcome(server, 'purge_repo', inRepo)).resolves.toBe('pending');
    expect(deletions).toBe(1);
  });

  it('still refuses a recorded denial', async () => {
    await grant(server);
    const denial = {
      toolId: DELETE_ACCOUNT_ID,
      state: ApprovalState.DENIED,
      scope: ApprovalScope.USER,
      grantedAt: Date.now(),
      userId: 'alice',
      grantedBy: { source: 'admin', identifier: 'security-team' },
    };
    await storage.namespace('approval').set(`${DELETE_ACCOUNT_ID}:user:alice`, JSON.stringify(denial));

    await expect(outcome(server)).resolves.toBe('denied');
    expect(deletions).toBe(0);
  });
});

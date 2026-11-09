/** Delegation chains, recorded in `DelegationContext.chain` and bounded by `maxDelegationDepth`. */
import 'reflect-metadata';

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

import {
  agentGrantor,
  ApprovalOperationError,
  ApprovalRequiredError,
  delegationDepth,
  delegationProblem,
  extendDelegation,
  type DelegationContext,
} from '../approval';
import ApprovalPlugin from '../approval.plugin';
import { ApprovalStorageStore } from '../stores';
import { ApprovalScope, ApprovalState } from '../types';

const TOOL_ID = 'ops:deploy';
const toPlanner: DelegationContext = { delegatorId: 'user-1', delegateId: 'planner', purpose: 'release' };
const toDeployer = extendDelegation(toPlanner, 'deployer', { purpose: 'deploy step' });
const toRunner = extendDelegation(toDeployer, 'runner');
const toWorker = extendDelegation(toRunner, 'worker');

describe('delegation chains', () => {
  it('extends a delegation with the delegate as the next delegator', () => {
    expect(toDeployer).toEqual({
      delegatorId: 'planner',
      delegateId: 'deployer',
      purpose: 'deploy step',
      chain: [{ delegatorId: 'user-1', delegateId: 'planner', purpose: 'release' }],
    });
    expect(toWorker.chain?.map((link) => link.delegateId)).toEqual(['planner', 'deployer', 'runner']);
    expect([toPlanner, toDeployer, toRunner, toWorker].map(delegationDepth)).toEqual([1, 2, 3, 4]);
  });

  it('accepts a chain within the depth, and names what is wrong with one that is not', () => {
    expect(delegationProblem(toRunner, 3)).toBeUndefined();
    expect(delegationProblem(toWorker, 3)).toBe('the delegation chain is 4 deep, and maxDelegationDepth is 3');
    expect(delegationProblem(toPlanner, 0)).toBe('the delegation chain is 1 deep, and maxDelegationDepth is 0');
    expect(delegationProblem({ ...toDeployer, delegatorId: 'intruder' }, 3)).toBe(
      'the delegation chain is broken: intruder was not delegated to by user-1',
    );
    expect(delegationProblem(extendDelegation(toDeployer, 'user-1'), 5)).toBe(
      'the delegation chain names user-1 twice',
    );
    expect(delegationProblem({ delegatorId: 'agent', delegateId: 'agent' }, 3)).toBe(
      'the delegation chain names agent twice',
    );
  });
});

describe('ApprovalStorageStore with maxDelegationDepth', () => {
  let storage: RootStorage;
  let store: ApprovalStorageStore;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.connect();
    store = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0, maxDelegationDepth: 3 });
    await store.initialize();
  });

  const grant = (context: DelegationContext) =>
    store.grantApproval({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      sessionId: 'session-1',
      grantedBy: agentGrantor(context.delegateId, context),
    });

  it('records a delegated approval within the depth, with its chain', async () => {
    await grant(toRunner);

    const [record] = await store.getApprovals(TOOL_ID, 'session-1');
    expect(record.grantedBy.delegationContext).toEqual(toRunner);
  });

  it('refuses a delegated approval deeper than the depth, or with a broken chain', async () => {
    await expect(grant(toWorker)).rejects.toThrow(ApprovalOperationError);
    await expect(grant(toWorker)).rejects.toThrow('the delegation chain is 4 deep, and maxDelegationDepth is 3');
    await expect(grant({ ...toDeployer, delegatorId: 'intruder' })).rejects.toThrow('the delegation chain is broken');

    expect(await store.getApprovals(TOOL_ID, 'session-1')).toEqual([]);
  });

  it('keeps a denial whatever its chain', async () => {
    await store.denyApproval({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      sessionId: 'session-1',
      grantedBy: agentGrantor('worker', toWorker),
    });

    expect(await store.getApprovals(TOOL_ID, 'session-1')).toEqual([
      expect.objectContaining({ state: ApprovalState.DENIED }),
    ]);
  });

  it('does not return a stored approval deeper than its depth', async () => {
    const lenient = new ApprovalStorageStore({
      storageInstance: storage,
      cleanupIntervalSeconds: 0,
      maxDelegationDepth: 5,
    });
    await lenient.initialize();
    await lenient.grantApproval({
      toolId: TOOL_ID,
      scope: ApprovalScope.SESSION,
      sessionId: 'session-1',
      grantedBy: agentGrantor('worker', toWorker),
    });

    expect(await lenient.getApprovals(TOOL_ID, 'session-1')).toHaveLength(1);
    expect(await store.getApprovals(TOOL_ID, 'session-1')).toEqual([]);
    expect(await store.isApproved(TOOL_ID, 'session-1')).toBe(false);
  });

  it('allows three delegations without maxDelegationDepth', async () => {
    const byDefault = new ApprovalStorageStore({ storageInstance: storage, cleanupIntervalSeconds: 0 });
    await byDefault.initialize();
    const grantWith = (context: DelegationContext) =>
      byDefault.grantApproval({
        toolId: TOOL_ID,
        scope: ApprovalScope.SESSION,
        sessionId: 'session-1',
        grantedBy: agentGrantor(context.delegateId, context),
      });

    await expect(grantWith(toRunner)).resolves.toBeDefined();
    await expect(grantWith(toWorker)).rejects.toThrow('maxDelegationDepth is 3');
  });
});

describe('ApprovalPlugin maxDelegationDepth', () => {
  let server: DirectMcpServer;
  const caller: DirectAuthContext = { sessionId: 'session-1', user: { sub: 'user-1' } };

  @Tool({ name: 'deploy', description: 'Deploys', inputSchema: {}, approval: true })
  class DeployTool extends ToolContext {
    async execute() {
      return { deployed: true };
    }
  }

  @Tool({ name: 'delegate_deploy', description: 'Lets a delegate approve deploy', inputSchema: {} })
  class DelegateDeployTool extends ToolContext {
    async execute() {
      await this.approval.grantSessionApproval(TOOL_ID, { grantedBy: agentGrantor('deployer', toDeployer) });
      return { delegated: true };
    }
  }

  afterEach(async () => {
    await server.dispose();
  });

  async function start(maxDelegationDepth?: number) {
    const storage = createMemoryStorage();
    await storage.connect();
    @App({
      id: 'ops',
      name: 'Ops',
      plugins: [ApprovalPlugin.init({ storageInstance: storage, maxDelegationDepth })],
      tools: [DeployTool, DelegateDeployTool],
    })
    class OpsApp {}
    server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-delegation', version: '1.0.0' },
      apps: [OpsApp],
      logging: { level: LogLevel.Off },
    });
  }

  async function call(name: string) {
    try {
      return await server.callTool(name, {}, { authContext: caller });
    } catch (error) {
      return error;
    }
  }

  it('lets a delegated approval within the depth run the tool', async () => {
    await start();

    expect(await call('delegate_deploy')).toMatchObject({ structuredContent: { delegated: true } });
    expect(await call('deploy')).toMatchObject({ structuredContent: { deployed: true } });
  });

  it('refuses a delegated approval deeper than maxDelegationDepth', async () => {
    await start(1);

    const refused = await call('delegate_deploy');
    expect(refused).toBeInstanceOf(ApprovalOperationError);
    expect((refused as Error).message).toContain('the delegation chain is 2 deep, and maxDelegationDepth is 1');
    expect(await call('deploy')).toBeInstanceOf(ApprovalRequiredError);
  });
});

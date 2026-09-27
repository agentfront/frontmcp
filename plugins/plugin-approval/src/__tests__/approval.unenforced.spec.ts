/**
 * `approval` must never be silently ignored.
 *
 * The gate is a hook of `ApprovalPlugin`. On a server where no approval plugin reaches a tool,
 * an `approval: true` tool ran for anyone, and `@Agent({ approval })` was never gated at all:
 * the field was not carried over to the agent's `invoke_<agent>` tool, so even an installed
 * plugin never saw it. The server now refuses to start without a plugin that enforces it, and an
 * agent's `approval` gates its tool like a tool's.
 */
import 'reflect-metadata';

import {
  Agent,
  AgentContext,
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  UnenforcedMetadataError,
  type DirectAuthContext,
  type DirectMcpServer,
  type FrontMcpConfigInput,
} from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalPlugin, ApprovalRequiredError } from '../index';

const executed: string[] = [];

@Tool({ name: 'delete_repo', inputSchema: {}, approval: true })
class DeleteRepoTool extends ToolContext {
  async execute() {
    executed.push('delete_repo');
    return { deleted: true };
  }
}

@Agent({
  name: 'refunds',
  description: 'Issues refunds',
  inputSchema: {},
  llm: { adapter: { completion: async () => ({ content: 'refunded', finishReason: 'stop' as const }) } },
  approval: true,
})
class RefundsAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    executed.push('refunds');
    return { refunded: true };
  }
}

const CALLER: DirectAuthContext = { sessionId: 'session-alice', user: { sub: 'alice' } };

/** Server-level plugins: the config type names plugin classes, and an `init()` result is accepted at run time. */
const serverPlugins = (...plugins: unknown[]) => plugins as FrontMcpConfigInput['plugins'];

function config(app: Record<string, unknown>, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  @App({ id: 'repos', name: 'Repos', ...app })
  class ReposApp {}
  return {
    info: { name: 'approval-unenforced', version: '1.0.0' },
    apps: [ReposApp],
    logging: { level: LogLevel.Off },
    ...extra,
  };
}

async function outcome(server: DirectMcpServer, name: string): Promise<'ran' | 'refused'> {
  try {
    await server.callTool(name, {}, { authContext: CALLER });
    return 'ran';
  } catch (error) {
    if (error instanceof ApprovalRequiredError) return 'refused';
    throw error;
  }
}

describe('approval without an approval plugin', () => {
  it('refuses to start a server whose approval tool no plugin enforces', async () => {
    const startup = FrontMcpInstance.createDirect(config({ tools: [DeleteRepoTool] }));

    await expect(startup).rejects.toBeInstanceOf(UnenforcedMetadataError);
    await expect(startup).rejects.toThrow(/Tool "delete_repo".*'approval'/);
  });

  it('refuses to start a server whose approval agent no plugin enforces', async () => {
    const startup = FrontMcpInstance.createDirect(config({ agents: [RefundsAgent] }));

    await expect(startup).rejects.toThrow(/Agent "refunds".*'approval'/);
  });

  it('starts with ApprovalPlugin on the server', async () => {
    const storage = createMemoryStorage();
    await storage.connect();
    const server = await FrontMcpInstance.createDirect(
      config(
        { tools: [DeleteRepoTool] },
        { plugins: serverPlugins(ApprovalPlugin.init({ storageInstance: storage })) },
      ),
    );
    try {
      expect(await outcome(server, 'delete_repo')).toBe('refused');
    } finally {
      await server.dispose();
    }
  });
});

describe('@Agent({ approval })', () => {
  let server: DirectMcpServer;

  beforeEach(async () => {
    executed.length = 0;
    const storage = createMemoryStorage();
    await storage.connect();
    server = await FrontMcpInstance.createDirect(
      config({ agents: [RefundsAgent], plugins: [ApprovalPlugin.init({ storageInstance: storage })] }),
    );
  });

  afterEach(async () => {
    await server.dispose();
  });

  it("gates the agent's tool like a tool", async () => {
    expect(await outcome(server, 'invoke_refunds')).toBe('refused');
    expect(executed).toEqual([]);
  });
});

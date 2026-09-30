/**
 * What an MCP client receives when the approval gate refuses a call (#647).
 *
 * `ApprovalError` extended `Error`, so the SDK wrapped every refusal as an internal server
 * error: outside production the text carried a stack trace, and in production the client got
 * "Internal FrontMCP error" instead of the tool's `approvalMessage`.
 */
import 'reflect-metadata';

import { Client, type CallToolResult } from '@frontmcp/protocol';
import { App, createInMemoryServer, FrontMcpInstance, LogLevel, Tool, ToolContext } from '@frontmcp/sdk';

import { ApprovalPlugin } from '../index';

const APPROVAL_MESSAGE = 'Deploying to production needs a human OK.';

@Tool({
  name: 'deploy_service',
  description: 'Deploys a service to production',
  inputSchema: {},
  approval: { required: true, approvalMessage: APPROVAL_MESSAGE },
})
class DeployServiceTool extends ToolContext {
  async execute() {
    return { deployed: true };
  }
}

@App({ id: 'ops', name: 'Ops', plugins: [ApprovalPlugin.init({})], tools: [DeployServiceTool] })
class OpsApp {}

interface ConnectedClient {
  client: Client;
  close(): Promise<void>;
}

async function connectClient(): Promise<ConnectedClient> {
  const instance = await FrontMcpInstance.createForGraph({
    info: { name: 'approval-refusal-result', version: '1.0.0' },
    apps: [OpsApp],
    logging: { level: LogLevel.Off },
  });
  const scope = instance.getScopes()[0];
  if (!scope) throw new Error('the server config produced no scope');

  const { clientTransport, close } = await createInMemoryServer(scope as Parameters<typeof createInMemoryServer>[0]);
  const client = new Client({ name: 'approval-refusal-result-spec', version: '1.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    async close() {
      await client.close();
      await close();
    },
  };
}

async function refusal(connected: ConnectedClient): Promise<CallToolResult> {
  return (await connected.client.callTool({ name: 'deploy_service', arguments: {} })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
  const [first] = result.content;
  return first?.type === 'text' ? first.text : '';
}

describe.each([
  ['outside production', undefined],
  ['in production', 'production'],
])('approval refusal result %s (#647)', (_label, nodeEnv) => {
  const originalNodeEnv = process.env['NODE_ENV'];
  let connected: ConnectedClient;

  beforeEach(async () => {
    // Set before the server is built: the handlers read it when they are created.
    if (nodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = nodeEnv;
    connected = await connectClient();
  });

  afterEach(async () => {
    await connected.close();
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  it("answers with exactly the tool's approvalMessage", async () => {
    const result = await refusal(connected);

    expect({ isError: result.isError, text: textOf(result) }).toEqual({ isError: true, text: APPROVAL_MESSAGE });
  });

  it('carries no stack trace in the text', async () => {
    const result = await refusal(connected);

    expect(textOf(result)).not.toMatch(/\n\s+at /);
  });

  it('marks the refusal with the APPROVAL_REQUIRED code', async () => {
    const result = await refusal(connected);

    expect(result._meta?.['code']).toBe('APPROVAL_REQUIRED');
  });
});

describe('approval refusal result in production (#647)', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('sends no stack in _meta', async () => {
    process.env['NODE_ENV'] = 'production';
    const connected = await connectClient();
    try {
      const result = await refusal(connected);

      expect(result._meta).not.toHaveProperty('stack');
    } finally {
      await connected.close();
    }
  });
});

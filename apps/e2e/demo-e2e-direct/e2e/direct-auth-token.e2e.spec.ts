/**
 * An in-process client's `authToken` on a server without `auth` reaches the tools of an anonymous caller, as on a
 * public server (#1124): 1.11.1-rc.1 failed the connection with `Flow "session:verify" is not registered`.
 */
import {
  App,
  connect,
  connectClaude,
  connectLangChain,
  connectOpenAI,
  connectVercelAI,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectClient,
} from '@frontmcp/sdk';

@Tool({ name: 'whoami', description: 'Who is calling', inputSchema: {} })
class WhoAmITool extends ToolContext {
  async execute() {
    return { sub: this.auth.user.sub, anonymous: this.auth.isAnonymous, token: this.authInfo?.token ?? null };
  }
}

@App({ id: 'desk', name: 'Desk', tools: [WhoAmITool] })
class DeskApp {}

const info = { name: 'desk', version: '1.0.0' };
const logging = { level: LogLevel.Off };
const anonymousWithToken = { sub: '', anonymous: true, token: 'tok_123' };

/** The caller `whoami` saw, from the result in the client's platform format. */
function callerOf(result: unknown): unknown {
  if (Array.isArray(result)) return JSON.parse((result[0] as { text: string }).text);
  if (typeof result === 'string') return JSON.parse(result);
  return (result as { structuredContent?: unknown }).structuredContent ?? result;
}

async function whoami(client: DirectClient): Promise<unknown> {
  try {
    return callerOf(await client.callTool('whoami', {}));
  } finally {
    await client.close();
  }
}

describe('an authToken on a server without auth', () => {
  it('connect() serves an anonymous caller, and the tool sees the token', async () => {
    const client = await connect({ info, logging, apps: [DeskApp] }, { authToken: 'tok_123' });

    expect(await whoami(client)).toEqual(anonymousWithToken);
  });

  it('a public server serves the same caller', async () => {
    const client = await connect(
      { info, logging, apps: [DeskApp], auth: { mode: 'public' } },
      { authToken: 'tok_123' },
    );

    expect(await whoami(client)).toEqual(anonymousWithToken);
  });

  it('connect() without a token serves an anonymous caller with no token', async () => {
    const client = await connect({ info, logging, apps: [DeskApp] });

    expect(await whoami(client)).toEqual({ sub: '', anonymous: true, token: null });
  });

  it.each([
    ['connectOpenAI', connectOpenAI],
    ['connectClaude', connectClaude],
    ['connectLangChain', connectLangChain],
    ['connectVercelAI', connectVercelAI],
  ])('%s serves an anonymous caller, and the tool sees the token', async (_name, connectAs) => {
    const client = await connectAs({ info, logging, apps: [DeskApp] }, { authToken: 'tok_123' });

    expect(await whoami(client)).toEqual(anonymousWithToken);
  });

  it('createDirect().connect() serves an anonymous caller, and the tool sees the token', async () => {
    const server = await FrontMcpInstance.createDirect({ info, logging, apps: [DeskApp] });
    try {
      expect(await whoami(await server.connect({ authToken: 'tok_123' }))).toEqual(anonymousWithToken);
    } finally {
      await server.dispose();
    }
  });
});

import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { PublicMcpError, ToolCallError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { connect, connectClaude, connectOpenAI } from '../connect';

@Tool({ name: 'confirm_delete', inputSchema: { path: z.string() } })
class ConfirmDeleteTool extends ToolContext {
  async execute(input: { path: string }) {
    const answer = await this.elicit(`Delete ${input.path}?`, z.object({ confirmed: z.boolean() }));
    return { action: answer.status, confirmed: answer.content?.confirmed ?? false };
  }
}

@Tool({ name: 'who_is_calling', inputSchema: {} })
class WhoIsCallingTool extends ToolContext {
  async execute() {
    return { client: this.clientInfo?.name ?? 'unknown' };
  }
}

@Tool({ name: 'always_fails', inputSchema: {} })
class AlwaysFailsTool extends ToolContext {
  async execute(): Promise<{ ok: boolean }> {
    this.fail(new PublicMcpError('The ticket is locked'));
  }
}

@Tool({ name: 'report_progress', inputSchema: {} })
class ReportProgressTool extends ToolContext {
  async execute() {
    return { first: await this.progress(1, 2, 'half'), second: await this.progress(2, 2) };
  }
}

@Tool({ name: 'send_notice', inputSchema: {} })
class SendNoticeTool extends ToolContext {
  async execute() {
    return { sent: await this.notify('ticket updated') };
  }
}

@Tool({ name: 'caller_scopes', inputSchema: {} })
class CallerScopesTool extends ToolContext {
  async execute() {
    return { scopes: this.auth.scopes, canWrite: this.auth.hasScope('tickets:write') };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [ConfirmDeleteTool, WhoIsCallingTool, AlwaysFailsTool, ReportProgressTool, SendNoticeTool, CallerScopesTool],
})
class DeskApp {}

function config(): FrontMcpConfigInput {
  return {
    info: { name: 'connect-client', version: '1.0.0' },
    apps: [DeskApp],
    logging: { level: LogLevel.Off },
    elicitation: { enabled: true },
  };
}

describe('connect() clients', () => {
  it('sends this.elicit() questions to the onElicitation handler passed to connect()', async () => {
    const asked: string[] = [];
    const client = await connect(config(), {
      onElicitation: async (request) => {
        asked.push(request.message);
        return { action: 'accept', content: { confirmed: true } };
      },
    });

    const result = (await client.callTool('confirm_delete', { path: 'notes.txt' })) as {
      structuredContent?: unknown;
    };
    await client.close();

    expect(asked).toEqual(['Delete notes.txt?']);
    expect(result.structuredContent).toEqual({ action: 'accept', confirmed: true });
  });

  it('sends the questions to a handler registered later when the client declares elicitation', async () => {
    const client = await connect(config(), { capabilities: { elicitation: { form: {} } } });
    client.onElicitation(async () => ({ action: 'accept', content: { confirmed: true } }));

    const result = (await client.callTool('confirm_delete', { path: 'notes.txt' })) as {
      structuredContent?: unknown;
    };
    await client.close();

    expect(result.structuredContent).toEqual({ action: 'accept', confirmed: true });
  });

  it('leaves a client with no elicitation handler to the fallback flow instead of declining', async () => {
    const client = await connectOpenAI(config());

    const result = await client.callTool('confirm_delete', { path: 'notes.txt' });
    await client.close();

    expect(JSON.stringify(result)).toContain('sendElicitationResult');
    expect(JSON.stringify(result)).not.toContain('"confirmed":false');
  });

  it('gives the onElicitation handler the elicitId and expiresAt of the question', async () => {
    const asked: Array<{ elicitId: string; expiresAt: number; mode: string }> = [];
    const client = await connect(config(), {
      onElicitation: async ({ elicitId, expiresAt, mode }) => {
        asked.push({ elicitId, expiresAt, mode });
        return { action: 'decline' };
      },
    });

    await client.callTool('confirm_delete', { path: 'notes.txt' });
    await client.close();

    expect(asked).toEqual([
      { elicitId: expect.stringMatching(/^elicit-/), expiresAt: expect.any(Number), mode: 'form' },
    ]);
    expect(asked[0].expiresAt).toBeGreaterThan(Date.now());
  });

  it('answers a fallback question with submitElicitationResult(), returning the tool result', async () => {
    const client = await connect(config());

    const pending = (await client.callTool('confirm_delete', { path: 'notes.txt' })) as {
      _meta: { elicitationPending: { elicitId: string } };
    };
    const answered = (await client.submitElicitationResult(pending._meta.elicitationPending.elicitId, {
      action: 'accept',
      content: { confirmed: true },
    })) as { structuredContent?: unknown };
    await client.close();

    expect(answered.structuredContent).toEqual({ action: 'accept', confirmed: true });
  });

  it('sends a tool its progress token when callTool() has onProgress', async () => {
    const client = await connect(config());
    const updates: unknown[] = [];

    const withHandler = (await client.callTool('report_progress', {}, { onProgress: (p) => updates.push(p) })) as {
      structuredContent?: unknown;
    };
    const withoutHandler = (await client.callTool('report_progress', {})) as { structuredContent?: unknown };
    await client.close();

    expect(withHandler.structuredContent).toEqual({ first: true, second: true });
    expect(updates).toEqual([
      { progress: 1, total: 2, message: 'half' },
      { progress: 2, total: 2 },
    ]);
    expect(withoutHandler.structuredContent).toEqual({ first: false, second: false });
  });

  it("gives a tool the session's scopes", async () => {
    const client = await connect(config(), { session: { user: { sub: 'nour' }, scopes: ['tickets:write'] } });

    const result = (await client.callTool('caller_scopes', {})) as { structuredContent?: unknown };
    await client.close();

    expect(result.structuredContent).toEqual({ scopes: ['tickets:write'], canWrite: true });
  });

  it('sets the log level', async () => {
    const client = await connect(config());

    await expect(client.setLogLevel('debug')).resolves.toBeUndefined();
    await client.close();
  });

  it("keeps the other clients' sessions when one closes", async () => {
    const shared = config();
    const first = await connect(shared, { clientInfo: { name: 'first-client', version: '1.0.0' } });
    const second = await connect(shared, { clientInfo: { name: 'second-client', version: '1.0.0' } });

    await first.close();
    const result = (await second.callTool('who_is_calling', {})) as { structuredContent?: unknown };
    await second.close();

    expect(result.structuredContent).toEqual({ client: 'second-client' });
  });

  it("keeps the other clients' sessions when one closes twice", async () => {
    const shared = config();
    const first = await connect(shared, { clientInfo: { name: 'first-client', version: '1.0.0' } });
    const second = await connect(shared, { clientInfo: { name: 'second-client', version: '1.0.0' } });

    await first.close();
    await first.close();
    const result = (await second.callTool('who_is_calling', {})) as { structuredContent?: unknown };
    await second.close();

    expect(result.structuredContent).toEqual({ client: 'second-client' });
  });

  it('gives a client that connects while the last one closes a live server', async () => {
    const shared = config();
    const first = await connect(shared, { clientInfo: { name: 'first-client', version: '1.0.0' } });

    const [second] = await Promise.all([
      connect(shared, { clientInfo: { name: 'second-client', version: '1.0.0' } }),
      first.close(),
    ]);
    const result = (await second.callTool('who_is_calling', {})) as { structuredContent?: unknown };
    await second.close();

    expect(result.structuredContent).toEqual({ client: 'second-client' });
  });

  it.each([
    ['connectOpenAI', connectOpenAI],
    ['connectClaude', connectClaude],
  ])('%s rejects a tool call that failed with a ToolCallError carrying its result', async (_label, connectTo) => {
    const client = await connectTo(config());

    const call = client.callTool('always_fails', {});
    await expect(call).rejects.toBeInstanceOf(ToolCallError);
    await expect(call).rejects.toMatchObject({
      message: 'The ticket is locked',
      result: expect.objectContaining({ isError: true }),
    });
    await client.close();
  });
});

describe('DirectMcpServer.connect() clients', () => {
  it('leave the server and the other clients working when one closes', async () => {
    const server = await FrontMcpInstance.createDirect(config());
    const closing = await server.connect();
    const staying = await server.connect();
    await staying.setLogLevel('info');

    await closing.close();
    const unregister = await server.registerTool({
      name: 'ping',
      execute: () => ({ content: [{ type: 'text', text: 'pong' }] }),
    });
    const notice = (await staying.callTool('send_notice', {})) as { structuredContent?: unknown };
    const ping = (await staying.callTool('ping', {})) as { content?: unknown };
    unregister();
    await staying.close();
    await server.dispose();

    expect(notice.structuredContent).toEqual({ sent: true });
    expect(ping.content).toEqual([{ type: 'text', text: 'pong' }]);
  });
});

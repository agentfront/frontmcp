import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, LogLevel, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';
import { PublicMcpError, ToolCallError } from '../../errors';
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

@App({ id: 'desk', name: 'Desk', tools: [ConfirmDeleteTool, WhoIsCallingTool, AlwaysFailsTool] })
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
  it('sends this.elicit() questions to onElicitation', async () => {
    const client = await connect(config());
    const asked: string[] = [];
    client.onElicitation(async (request) => {
      asked.push(request.message);
      return { action: 'accept', content: { confirmed: true } };
    });

    const result = (await client.callTool('confirm_delete', { path: 'notes.txt' })) as {
      structuredContent?: unknown;
    };
    await client.close();

    expect(asked).toEqual(['Delete notes.txt?']);
    expect(result.structuredContent).toEqual({ action: 'accept', confirmed: true });
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

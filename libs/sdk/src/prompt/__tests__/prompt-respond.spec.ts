import 'reflect-metadata';

import { type GetPromptResult } from '@frontmcp/protocol';

import { App, LogLevel, Prompt, PromptContext } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

const message = (text: string): GetPromptResult => ({ messages: [{ role: 'user', content: { type: 'text', text } }] });

@Prompt({ name: 'summarize_ticket', arguments: [{ name: 'id', required: true }] })
class SummarizeTicketPrompt extends PromptContext {
  async execute({ id }: Record<string, string>): Promise<GetPromptResult> {
    if (id === 'T-0') this.respond(message("There's no ticket T-0."));
    if (id === 'T-x') this.respond('Closed as a duplicate.' as never);
    if (id === 'T-y') return 'Closed as a duplicate.' as never;
    return message(`Summarize ticket ${id}.`);
  }
}

@App({ id: 'desk', name: 'Desk', prompts: [SummarizeTicketPrompt] })
class DeskApp {}

describe('this.respond() in a prompt', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'prompt-respond', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('ends the prompt with the value as its result', async () => {
    const result = await server.getPrompt('summarize_ticket', { id: 'T-0' });

    expect(result.messages).toEqual(message("There's no ticket T-0.").messages);
  });

  it('normalizes the value as a returned one', async () => {
    const responded = await server.getPrompt('summarize_ticket', { id: 'T-x' });
    const returned = await server.getPrompt('summarize_ticket', { id: 'T-y' });

    expect(responded).toEqual(returned);
    expect(JSON.stringify(responded.messages)).toContain('Closed as a duplicate.');
  });

  it('leaves a returned value as it was', async () => {
    const result = await server.getPrompt('summarize_ticket', { id: 'T-1' });

    expect(result.messages).toEqual(message('Summarize ticket T-1.').messages);
  });
});

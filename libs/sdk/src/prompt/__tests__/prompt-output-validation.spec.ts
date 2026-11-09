import 'reflect-metadata';

import { type GetPromptResult } from '@frontmcp/protocol';

import { App, LogLevel, Prompt, PromptContext } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { InvalidOutputError } from '../../errors';
import { invalidOutputFromParseFailure } from '../../errors/mcp.error';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';

@Prompt({ name: 'system_note', arguments: [] })
class SystemNotePrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'system', content: { type: 'text', text: 'Be brief.' } }] } as never;
  }
}

@App({ id: 'desk', name: 'Desk', prompts: [SystemNotePrompt] })
class DeskApp {}

describe("a prompt's invalid output (#1172)", () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'prompt-output-validation', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  it("fails with INVALID_OUTPUT, saying it is the prompt's output and naming the field and the reason", async () => {
    const failure = await server.getPrompt('system_note', {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(InvalidOutputError);
    expect((failure as InvalidOutputError).code).toBe('INVALID_OUTPUT');
    expect((failure as InvalidOutputError).name).toBe('InvalidOutputError');
    expect((failure as InvalidOutputError).message).toMatch(
      /^Prompt output validation failed \(.*"user".* at messages\.0\.role\)$/,
    );
    expect((failure as InvalidOutputError).details).toMatchObject({ entry: 'Prompt', path: 'messages.0.role' });
  });
});

describe('invalidOutputFromParseFailure', () => {
  it("names a resource's output and an error's message when the error has no issues", () => {
    const error = invalidOutputFromParseFailure('Resource', new Error('contents is not iterable'));

    expect(error.message).toBe('Resource output validation failed (contents is not iterable)');
  });

  it('keeps naming a tool by default', () => {
    expect(new InvalidOutputError({ reason: 'undeclared keys', value: 'secret' }).message).toBe(
      'Tool output validation failed (undeclared keys: secret)',
    );
  });
});

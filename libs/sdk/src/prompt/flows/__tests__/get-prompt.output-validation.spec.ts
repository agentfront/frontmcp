import 'reflect-metadata';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Prompt, PromptContext } from '../../../common';

@Prompt({ name: 'system_note' })
class SystemNotePrompt extends PromptContext {
  async execute() {
    return { messages: [{ role: 'system', content: { type: 'text', text: 'Be brief.' } }] };
  }
}

@Prompt({ name: 'greeting' })
class GreetingPrompt extends PromptContext {
  async execute() {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }] };
  }
}

@App({ id: 'notes', name: 'Notes', prompts: [SystemNotePrompt, GreetingPrompt] })
class NotesApp {}

describe('prompts/get output validation', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({ info: { name: 'prompt-output', version: '1.0.0' }, apps: [NotesApp] });
  });

  it('fails a result whose messages do not match the MCP prompt message shape with INVALID_OUTPUT', async () => {
    const { message } = await rpc20260728(server.handler, 'prompts/get', { name: 'system_note', arguments: {} });
    const errorData = message.error?.data as Record<string, unknown> | undefined;

    expect(message.result).toBeUndefined();
    expect(errorData?.['code']).toBe('INVALID_OUTPUT');
  });

  it('returns a result whose messages match the MCP prompt message shape', async () => {
    const { message } = await rpc20260728(server.handler, 'prompts/get', { name: 'greeting', arguments: {} });

    expect(message.result?.['messages']).toEqual([{ role: 'user', content: { type: 'text', text: 'Hello' } }]);
  });
});

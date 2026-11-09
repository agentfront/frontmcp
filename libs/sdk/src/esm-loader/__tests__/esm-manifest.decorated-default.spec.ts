import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, FrontMcp, Prompt, PromptContext, Provider, Tool, ToolContext } from '../../common';
import { normalizeEsmExport } from '../esm-manifest';

@Tool({ name: 'echo', inputSchema: { message: z.string() } })
class EchoTool extends ToolContext {
  async execute({ message }: { message: string }) {
    return message;
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@Prompt({ name: 'greet', arguments: [] })
class GreetPrompt extends PromptContext {
  async execute() {
    return { messages: [] };
  }
}

@Provider({ name: 'StatusStore' })
class StatusStore {}

@App({ name: 'status', providers: [StatusStore], tools: [EchoTool], prompts: [GreetPrompt] })
class StatusApp {}

@App({ name: 'health', tools: [PingTool] })
class HealthApp {}

describe('normalizeEsmExport() of a default-exported decorated class', () => {
  it("reads an @App class's entries", () => {
    const manifest = normalizeEsmExport({ default: StatusApp });

    expect(manifest).toMatchObject({
      name: 'status',
      version: '0.0.0',
      providers: [StatusStore],
      tools: [EchoTool],
      prompts: [GreetPrompt],
    });
  });

  it('reads exported @Provider classes as the providers of a package of decorated named exports', () => {
    const manifest = normalizeEsmExport({ EchoTool, StatusStore });

    expect(manifest).toMatchObject({ tools: [EchoTool], providers: [StatusStore] });
  });

  it("reads a @FrontMcp server's entries and those of its @App classes", () => {
    @FrontMcp({ info: { name: 'acme-status', version: '2.1.0' }, serve: false, apps: [StatusApp, HealthApp] })
    class Server {}

    const manifest = normalizeEsmExport({ default: Server });

    expect(manifest).toMatchObject({
      name: 'acme-status',
      version: '2.1.0',
      providers: [StatusStore],
      tools: [EchoTool, PingTool],
      prompts: [GreetPrompt],
    });
  });
});

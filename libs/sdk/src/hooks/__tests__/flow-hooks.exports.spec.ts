/**
 * The SDK exports hook decorators for the prompt and completion flows, as it does for tools and
 * resources. Exporting them puts those flows' augmentations in the published type graph, so
 * `FlowHooksOf('prompts:get-prompt' | 'prompts:list-prompts' | 'completion:complete')` typechecks
 * for consumers (#678).
 */
import 'reflect-metadata';

import { type GetPromptResult } from '@frontmcp/protocol';

import { type HookMetadata } from '../../common';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  App,
  CompletionHook,
  FlowHooksOf,
  ListPromptsHook,
  LogLevel,
  Plugin,
  Prompt,
  PromptContext,
  PromptHook,
  type FlowCtxOf,
} from '../../index';
import { collectHook } from '../hooks.utils';

const runs: string[] = [];

@Plugin({ name: 'prompt-audit' })
class PromptAuditPlugin {
  @PromptHook.Will('execute')
  beforePrompt(ctx: FlowCtxOf<'prompts:get-prompt'>) {
    runs.push(`get:${ctx.state.prompt?.name}`);
  }

  @ListPromptsHook.Did('findPrompts')
  afterList() {
    runs.push('list');
  }

  @CompletionHook.Will('complete')
  beforeComplete() {
    runs.push('complete');
  }
}

@Prompt({ name: 'greeting', arguments: [] })
class GreetingPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }] };
  }
}

@App({ id: 'prompts', name: 'Prompts', plugins: [PromptAuditPlugin], prompts: [GreetingPrompt] })
class PromptsApp {}

describe('prompt and completion hook exports', () => {
  it('register hooks for their flows', () => {
    const flows = (collectHook(PromptAuditPlugin) as HookMetadata[]).map((hook) => `${hook.flow}:${hook.stage}`);
    expect(flows).toEqual([
      'prompts:get-prompt:execute',
      'prompts:list-prompts:findPrompts',
      'completion:complete:complete',
    ]);
  });

  it('give the same decorators as FlowHooksOf', () => {
    expect(Object.keys(PromptHook)).toEqual(Object.keys(FlowHooksOf('prompts:get-prompt')));
  });

  describe('at runtime', () => {
    let server: DirectMcpServer;

    beforeAll(async () => {
      server = await FrontMcpInstance.createDirect({
        info: { name: 'prompt-hooks', version: '1.0.0' },
        apps: [PromptsApp],
        logging: { level: LogLevel.Off },
      });
    });

    afterAll(async () => {
      await server.dispose();
    });

    beforeEach(() => {
      runs.length = 0;
    });

    it('run on prompts/get and prompts/list', async () => {
      await server.getPrompt('greeting', {});
      await server.listPrompts();

      expect(runs).toEqual(['get:greeting', 'list']);
    });
  });
});

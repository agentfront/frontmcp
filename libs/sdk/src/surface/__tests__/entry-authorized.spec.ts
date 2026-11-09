import 'reflect-metadata';

import {
  AuthoritiesContextBuilder,
  AuthoritiesEngine,
  AuthoritiesEvaluatorRegistry,
  AuthoritiesProfileRegistry,
} from '@frontmcp/auth';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type GetPromptResult,
  type ReadResourceResult,
} from '../../common';
import { isListedByAuthorities } from '../entry-authorized';

const throwingGuard = (): boolean => {
  throw new Error('policy store down');
};

@Tool({ name: 'guard_throws', inputSchema: {}, authorities: { guards: [throwingGuard] } })
class GuardThrowsTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

@Tool({ name: 'guard_admits', inputSchema: {}, authorities: { guards: [() => true] } })
class GuardAdmitsTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

@Tool({ name: 'unguarded', inputSchema: {} })
class UnguardedTool extends ToolContext {
  async execute() {
    return { ran: true };
  }
}

@Resource({ name: 'guarded-resource', uri: 'desk://guarded', authorities: { guards: [throwingGuard] } })
class GuardedResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'guarded' }] };
  }
}

@Resource({ name: 'open-resource', uri: 'desk://open' })
class OpenResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'open' }] };
  }
}

@ResourceTemplate({
  name: 'guarded-template',
  uriTemplate: 'desk://guarded/{id}',
  authorities: { guards: [throwingGuard] },
})
class GuardedTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'guarded' }] };
  }
}

@ResourceTemplate({ name: 'open-template', uriTemplate: 'desk://open/{id}' })
class OpenTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'open' }] };
  }
}

@Prompt({ name: 'guarded-prompt', arguments: [], authorities: { guards: [throwingGuard] } })
class GuardedPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'guarded' } }] };
  }
}

@Prompt({ name: 'open-prompt', arguments: [] })
class OpenPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: 'open' } }] };
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [GuardThrowsTool, GuardAdmitsTool, UnguardedTool],
  resources: [GuardedResource, OpenResource, GuardedTemplate, OpenTemplate],
  prompts: [GuardedPrompt, OpenPrompt],
})
class DeskApp {}

describe('a guard that throws while a list is filtered (#1163)', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'list-guard-throws', version: '1.0.0' },
      apps: [DeskApp],
      authorities: {},
    });
  });

  async function listed(method: string, key: string, field: string): Promise<unknown[]> {
    const { message } = await rpc20260728(server.handler, method, {});
    expect(message.error).toBeUndefined();
    return (message.result?.[key] as Array<Record<string, unknown>>).map((entry) => entry[field]);
  }

  it('leaves out only that tool and lists the rest', async () => {
    expect((await listed('tools/list', 'tools', 'name')).sort()).toEqual(['guard_admits', 'unguarded']);
  });

  it('leaves out only that resource', async () => {
    expect(await listed('resources/list', 'resources', 'uri')).toEqual(['desk://open']);
  });

  it('leaves out only that resource template', async () => {
    expect(await listed('resources/templates/list', 'resourceTemplates', 'uriTemplate')).toEqual(['desk://open/{id}']);
  });

  it('leaves out only that prompt', async () => {
    expect(await listed('prompts/list', 'prompts', 'name')).toEqual(['open-prompt']);
  });
});

describe('isListedByAuthorities', () => {
  const engine = new AuthoritiesEngine(new AuthoritiesProfileRegistry(), new AuthoritiesEvaluatorRegistry());
  const contextBuilder = new AuthoritiesContextBuilder();

  it('answers the policy', async () => {
    await expect(isListedByAuthorities(engine, contextBuilder, { guards: [() => true] }, {}, 'open')).resolves.toBe(
      true,
    );
    await expect(isListedByAuthorities(engine, contextBuilder, { guards: [() => false] }, {}, 'shut')).resolves.toBe(
      false,
    );
  });

  it('leaves out an entry whose policy throws, and says which', async () => {
    const warn = jest.fn();

    await expect(
      isListedByAuthorities(engine, contextBuilder, { guards: [throwingGuard] }, {}, 'guard_throws', { warn }),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'The authorities of "guard_throws" failed to answer, so it is left out of the list: policy store down',
    );
  });
});

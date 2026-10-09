/**
 * Entry classes declare hooks for the stages before their instance exists as `static` methods (#701).
 *
 * A `@Tool`, `@Resource`, `@Prompt` or `@Agent` class used to fail startup for any hook on a stage the
 * call passes before its instance is built (`parseInput`, `findTool`, `checkToolAuthorization`, ...).
 * A static method needs no instance, so it joins the run when it starts: the flow resolves the entry
 * the call names before the first stage and adds that class's static hooks, and only that class's.
 * `this` is the class, and the hook gets the flow context as its argument, as instance hooks do.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import { type DirectMcpServer } from '../../direct/direct.types';
import { UnauthorizedError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  Agent,
  AgentCallHook,
  AgentContext,
  App,
  FlowHooksOf,
  ListToolsHook,
  LogLevel,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceHook,
  Tool,
  ToolContext,
  ToolHook,
  type FlowCtxOf,
} from '../../index';

const PromptHook = FlowHooksOf('prompts:get-prompt');

const runs: string[] = [];

const echoInput = { text: z.string(), user: z.string() };

@Tool({ name: 'guarded_echo', inputSchema: echoInput })
class GuardedEchoTool extends ToolContext {
  /** Runs before the tool is even looked up: no instance exists. */
  @ToolHook.Will('parseInput')
  static first(this: typeof GuardedEchoTool) {
    runs.push(`guarded_echo:will:parseInput:this-is-class=${this === GuardedEchoTool}`);
  }

  /** Rewrites the arguments the tool gets. */
  @ToolHook.Did('parseInput')
  static shout(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const input = flowCtx.state.required.input;
    const args = input.arguments ?? {};
    flowCtx.state.set('input', { ...input, arguments: { ...args, text: String(args['text']).toUpperCase() } });
  }

  /** Denies one caller before the instance is built. */
  @ToolHook.Will('checkToolAuthorization')
  static denyBlocked(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    runs.push(`guarded_echo:will:checkToolAuthorization:${flowCtx.state.tool?.name}`);
    if (flowCtx.state.input?.arguments?.['user'] === 'blocked') {
      throw new UnauthorizedError('user "blocked" may not call guarded_echo');
    }
  }

  /** A static hook on a later stage still runs once. */
  @ToolHook.Will('execute')
  static beforeExecute() {
    runs.push('guarded_echo:static:will:execute');
  }

  /** Instance hooks keep running on the instance. */
  @ToolHook.Did('createToolCallContext')
  built() {
    runs.push(`guarded_echo:instance:did:createToolCallContext:${this instanceof GuardedEchoTool}`);
  }

  async execute({ text }: { text: string; user: string }) {
    return { text };
  }
}

@Tool({ name: 'plain_echo', inputSchema: echoInput })
class PlainEchoTool extends ToolContext {
  async execute({ text }: { text: string; user: string }) {
    return { text };
  }
}

let vaultLocked = false;

@Resource({ name: 'vault', uri: 'vault://secret' })
class VaultResource extends ResourceContext {
  @ResourceHook.Will('findResource')
  static early(flowCtx: FlowCtxOf<'resources:read-resource'>) {
    runs.push(`vault:will:findResource:${flowCtx.state.input?.uri}`);
  }

  @ResourceHook.Will('createResourceContext')
  static lock() {
    if (vaultLocked) throw new UnauthorizedError('the vault is locked');
  }

  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'secret' }] };
  }
}

@Resource({ name: 'lobby', uri: 'lobby://open' })
class LobbyResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'open' }] };
  }
}

@Prompt({ name: 'greeting', arguments: [{ name: 'name', required: true }] })
class GreetingPrompt extends PromptContext {
  /** Fills a default before the prompt is looked up. */
  @PromptHook.Did('parseInput')
  static titleCase(flowCtx: FlowCtxOf<'prompts:get-prompt'>) {
    const input = flowCtx.state.required.input;
    const name = input.arguments?.['name'] ?? '';
    flowCtx.state.set('input', { ...input, arguments: { ...input.arguments, name: `Dr. ${name}` } });
  }

  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: `Hello ${args['name']}` } }] };
  }
}

@Prompt({ name: 'farewell', arguments: [{ name: 'name', required: true }] })
class FarewellPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    return { messages: [{ role: 'user', content: { type: 'text', text: `Bye ${args['name']}` } }] };
  }
}

const answer = { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) };

@Agent({ name: 'watched_agent', inputSchema: {}, llm: { adapter: answer } })
class WatchedAgent extends AgentContext {
  @AgentCallHook.Will('findAgent')
  static beforeFind(flowCtx: FlowCtxOf<'agents:call-agent'>) {
    runs.push(`watched_agent:will:findAgent:${flowCtx.state.input?.name}`);
  }

  @AgentCallHook.Will('checkAgentAuthorization')
  static beforeAuthorization(flowCtx: FlowCtxOf<'agents:call-agent'>) {
    runs.push(`watched_agent:will:checkAgentAuthorization:${flowCtx.state.agent?.name}`);
  }
}

@Agent({ name: 'quiet_agent', inputSchema: {}, llm: { adapter: answer } })
class QuietAgent extends AgentContext {}

@App({
  id: 'static-hooks',
  name: 'Static hooks',
  tools: [GuardedEchoTool, PlainEchoTool],
  resources: [VaultResource, LobbyResource],
  prompts: [GreetingPrompt, FarewellPrompt],
  agents: [WatchedAgent, QuietAgent],
})
class StaticHooksApp {}

describe('static entry-class hooks on stages before the instance exists (#701)', () => {
  let server: DirectMcpServer;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'entry-class-static-hooks', version: '1.0.0' },
      apps: [StaticHooksApp],
      logging: { level: LogLevel.Off },
    });
  });

  afterAll(async () => {
    await server.dispose();
  });

  beforeEach(() => {
    runs.length = 0;
    vaultLocked = false;
  });

  describe('tools', () => {
    it('runs from the first stage with the class as `this`, and rewrites the input', async () => {
      const result = await server.callTool('guarded_echo', { text: 'hi', user: 'ada' });

      expect(result.structuredContent).toEqual({ text: 'HI' });
      expect(runs).toEqual([
        'guarded_echo:will:parseInput:this-is-class=true',
        'guarded_echo:will:checkToolAuthorization:guarded_echo',
        'guarded_echo:instance:did:createToolCallContext:true',
        'guarded_echo:static:will:execute',
      ]);
    });

    it('denies a call before the instance is built', async () => {
      await expect(server.callTool('guarded_echo', { text: 'hi', user: 'blocked' })).rejects.toThrow(
        'user "blocked" may not call guarded_echo',
      );
      expect(runs).not.toContain('guarded_echo:instance:did:createToolCallContext:true');
    });

    it("does not run another tool's static hooks", async () => {
      const result = await server.callTool('plain_echo', { text: 'hi', user: 'blocked' });

      expect(result.structuredContent).toEqual({ text: 'hi' });
      expect(runs).toEqual([]);
    });
  });

  describe('resources', () => {
    it('runs a static hook before the resource is looked up', async () => {
      const result = await server.readResource('vault://secret');

      expect(JSON.stringify(result)).toContain('secret');
      expect(runs).toEqual(['vault:will:findResource:vault://secret']);
    });

    it('denies a read before the instance is built, for its own resource only', async () => {
      vaultLocked = true;

      await expect(server.readResource('vault://secret')).rejects.toThrow('the vault is locked');
      await expect(server.readResource('lobby://open')).resolves.toEqual(
        expect.objectContaining({ contents: [expect.objectContaining({ text: 'open' })] }),
      );
    });
  });

  describe('prompts', () => {
    it('rewrites the arguments of its own prompt only', async () => {
      const greeting = await server.getPrompt('greeting', { name: 'Ada' });
      const farewell = await server.getPrompt('farewell', { name: 'Ada' });

      expect(JSON.stringify(greeting)).toContain('Hello Dr. Ada');
      expect(JSON.stringify(farewell)).toContain('Bye Ada');
    });
  });

  describe('agents', () => {
    it('runs static hooks on the stages before the agent instance, for its own agent only', async () => {
      await server.callTool('invoke_watched_agent', {});
      await server.callTool('invoke_quiet_agent', {});

      expect(runs).toEqual([
        'watched_agent:will:findAgent:watched_agent',
        'watched_agent:will:checkAgentAuthorization:watched_agent',
      ]);
    });
  });
});

async function startWith(app: Parameters<typeof FrontMcpInstance.createDirect>[0]['apps'][number]) {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'entry-class-static-hooks-startup', version: '1.0.0' },
    apps: [app],
    logging: { level: LogLevel.Off },
  });
  await server.dispose();
}

describe('static entry-class hooks that would still never run fail at startup (#701)', () => {
  it('rejects a static list hook: a list run resolves no single entry', async () => {
    @Tool({ name: 'static_list_tool', inputSchema: {} })
    class StaticListTool extends ToolContext {
      @ListToolsHook.Did('findTools')
      static hide() {
        // never reached
      }

      async execute() {
        return {};
      }
    }
    @App({ id: 'static-list', name: 'StaticList', tools: [StaticListTool] })
    class StaticListApp {}

    await expect(startWith(StaticListApp)).rejects.toThrow(
      /Tool "StaticListTool" declares hooks that would never run: static hide\(\) \(did 'findTools' of tools:list-tools\)/,
    );
  });

  it('tells an instance hook on an early stage to become static', async () => {
    @Tool({ name: 'instance_early_tool', inputSchema: {} })
    class InstanceEarlyTool extends ToolContext {
      @ToolHook.Will('findTool')
      early() {
        // never reached: no instance exists yet
      }

      async execute() {
        return {};
      }
    }
    @App({ id: 'instance-early', name: 'InstanceEarly', tools: [InstanceEarlyTool] })
    class InstanceEarlyApp {}

    await expect(startWith(InstanceEarlyApp)).rejects.toThrow(
      /early\(\) \(will 'findTool' of tools:call-tool\): runs before 'createToolCallContext' builds the instance it runs on; declare it as a static method/,
    );
  });
});

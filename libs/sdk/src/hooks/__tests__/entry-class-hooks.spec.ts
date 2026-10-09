/**
 * Hooks declared on an entry class run on the instance built for each call. The SDK accepted hooks
 * that could never run there and dropped them silently (#678): hooks on stages that run before the
 * instance exists, list hooks (no instance is built to list entries), and any hook on a `@Job` class
 * (jobs do not run through a hookable flow). Each now fails at startup.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import { HookKind, type HookRecord } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import {
  Agent,
  AgentCallHook,
  AgentContext,
  App,
  FlowHooksOf,
  Job,
  JobContext,
  ListResourcesHook,
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
  type FrontMcpConfigInput,
} from '../../index';
import { describeUnreachableEntryClassHooks, unreachableHooksMessage } from '../entry-class-hooks';

function hook(
  flow: string,
  type: 'will' | 'did' | 'around' | 'stage',
  stage: string,
  method = 'm',
  isStatic = false,
): HookRecord {
  return {
    kind: HookKind.METHOD_TOKEN,
    provide: () => undefined,
    metadata: { flow, type, stage, method, target: null, static: isStatic } as HookRecord['metadata'],
  };
}

const join = {
  flow: 'tools:call-tool',
  plan: { pre: ['parseInput', 'findTool', 'createToolCallContext', 'acquireQuota'], execute: ['execute'] },
  contextStage: 'createToolCallContext',
} as const;

describe('describeUnreachableEntryClassHooks', () => {
  it('accepts hooks on and after the stage that builds the instance', () => {
    const hooks = [
      hook('tools:call-tool', 'did', 'createToolCallContext'),
      hook('tools:call-tool', 'stage', 'createToolCallContext'),
      hook('tools:call-tool', 'will', 'acquireQuota'),
      hook('tools:call-tool', 'around', 'execute'),
    ];
    expect(describeUnreachableEntryClassHooks(hooks, join, ['tools:list-tools'])).toEqual([]);
  });

  it('flags hooks on earlier stages, and Will or Around on the stage that builds the instance', () => {
    const problems = describeUnreachableEntryClassHooks(
      [
        hook('tools:call-tool', 'will', 'findTool', 'early'),
        hook('tools:call-tool', 'will', 'createToolCallContext', 'beforeBuild'),
        hook('tools:call-tool', 'around', 'createToolCallContext', 'aroundBuild'),
      ],
      join,
      [],
    );
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("early() (will 'findTool' of tools:call-tool)");
    expect(problems[0]).toContain("runs before 'createToolCallContext'");
    expect(problems[0]).toContain('declare it as a static method to run it without an instance');
  });

  it('accepts static hooks on any stage of the entry flow, the stage that builds the instance included (#701)', () => {
    const hooks = [
      hook('tools:call-tool', 'will', 'parseInput', 'first', true),
      hook('tools:call-tool', 'around', 'findTool', 'wrap', true),
      hook('tools:call-tool', 'will', 'createToolCallContext', 'beforeBuild', true),
      hook('tools:call-tool', 'did', 'execute', 'after', true),
    ];
    expect(describeUnreachableEntryClassHooks(hooks, join, ['tools:list-tools'])).toEqual([]);
  });

  it('still flags a static list-flow hook (#701)', () => {
    const problems = describeUnreachableEntryClassHooks(
      [hook('tools:list-tools', 'did', 'findTools', 'hide', true)],
      join,
      ['tools:list-tools'],
    );
    expect(problems).toEqual([
      "static hide() (did 'findTools' of tools:list-tools): list flows build no entry instance and resolve no single entry to run it for",
    ]);
  });

  it('flags every list-flow hook', () => {
    const problems = describeUnreachableEntryClassHooks([hook('tools:list-tools', 'did', 'findTools', 'hide')], join, [
      'tools:list-tools',
    ]);
    expect(problems).toEqual([
      "hide() (did 'findTools' of tools:list-tools): list flows build no entry instance and resolve no single entry to run it for",
    ]);
  });

  it('ignores other flows and stages the plan does not name', () => {
    const hooks = [hook('resources:read-resource', 'will', 'parseInput'), hook('tools:call-tool', 'will', 'unknown')];
    expect(describeUnreachableEntryClassHooks(hooks, join, [])).toEqual([]);
  });

  it('builds a startup message naming the class and each hook', () => {
    expect(unreachableHooksMessage('Tool', 'MyTool', ['a', 'b'])).toMatch(
      /^Tool "MyTool" declares hooks that would never run: a; b\. Hooks declared as instance methods on a tool class .*static methods run without one/,
    );
  });
});

const PromptHook = FlowHooksOf('prompts:get-prompt');
const ListPromptsHook = FlowHooksOf('prompts:list-prompts');

async function startWith(app: FrontMcpConfigInput['apps'][number], extra: Partial<FrontMcpConfigInput> = {}) {
  const server = await FrontMcpInstance.createDirect({
    info: { name: 'entry-class-hooks', version: '1.0.0' },
    apps: [app],
    logging: { level: LogLevel.Off },
    ...extra,
  });
  await server.dispose();
}

describe('entry class hooks that would never run fail at startup', () => {
  it('rejects a tool class hook on a stage before the tool instance exists', async () => {
    @Tool({ name: 'early_tool', inputSchema: {} })
    class EarlyTool extends ToolContext {
      @ToolHook.Will('checkToolAuthorization')
      audit() {
        // never reached: no instance exists yet
      }

      async execute() {
        return {};
      }
    }
    @App({ id: 'early', name: 'Early', tools: [EarlyTool] })
    class EarlyApp {}

    await expect(startWith(EarlyApp)).rejects.toThrow(
      /Tool "EarlyTool" declares hooks that would never run: audit\(\) \(will 'checkToolAuthorization'/,
    );
  });

  it('rejects a list hook declared on a tool class', async () => {
    @Tool({ name: 'listed_tool', inputSchema: {} })
    class ListedTool extends ToolContext {
      @ListToolsHook.Did('findTools')
      hide() {
        // never reached: listing builds no instance
      }

      async execute() {
        return {};
      }
    }
    @App({ id: 'listed', name: 'Listed', tools: [ListedTool] })
    class ListedApp {}

    await expect(startWith(ListedApp)).rejects.toThrow(
      /Tool "ListedTool" declares hooks that would never run: hide\(\)/,
    );
  });

  it('rejects a list hook declared on a resource class', async () => {
    @Resource({ name: 'listed', uri: 'listed://one' })
    class ListedResource extends ResourceContext {
      @ListResourcesHook.Did('findResources')
      hide() {
        // never reached
      }

      async execute(uri: string): Promise<ReadResourceResult> {
        return { contents: [{ uri, text: '' }] };
      }
    }
    @App({ id: 'listed-resource', name: 'ListedResource', resources: [ListedResource] })
    class ListedResourceApp {}

    await expect(startWith(ListedResourceApp)).rejects.toThrow(/Resource "ListedResource" declares hooks/);
  });

  it('rejects early and list hooks on prompt classes', async () => {
    @Prompt({ name: 'early_prompt', arguments: [] })
    class EarlyPrompt extends PromptContext {
      @PromptHook.Will('findPrompt')
      early() {
        // never reached
      }

      @ListPromptsHook.Did('findPrompts')
      hide() {
        // never reached
      }

      async execute(): Promise<GetPromptResult> {
        return { messages: [] };
      }
    }
    @App({ id: 'early-prompt', name: 'EarlyPrompt', prompts: [EarlyPrompt] })
    class EarlyPromptApp {}

    await expect(startWith(EarlyPromptApp)).rejects.toThrow(
      /Prompt "EarlyPrompt" declares hooks .*early\(\).*hide\(\)/,
    );
  });

  it('rejects an agent class hook on a stage before the agent instance exists', async () => {
    @Agent({
      name: 'early_agent',
      inputSchema: {},
      llm: { adapter: { completion: async () => ({ content: 'x', finishReason: 'stop' as const }) } },
    })
    class EarlyAgent extends AgentContext {
      @AgentCallHook.Will('findAgent')
      early() {
        // never reached
      }
    }
    @App({ id: 'early-agent', name: 'EarlyAgent', agents: [EarlyAgent] })
    class EarlyAgentApp {}

    await expect(startWith(EarlyAgentApp)).rejects.toThrow(/Agent "EarlyAgent" declares hooks that would never run/);
  });

  it('rejects any hook declared on a job class', async () => {
    @Job({ name: 'hooked_job', inputSchema: {}, outputSchema: { ok: z.boolean() } })
    class HookedJob extends JobContext {
      @ToolHook.Will('execute')
      audit() {
        // never reached: jobs do not run through a hookable flow
      }

      async execute() {
        return { ok: true };
      }
    }
    @App({ id: 'jobs', name: 'Jobs', jobs: [HookedJob] })
    class JobsApp {}

    await expect(startWith(JobsApp, { jobs: { enabled: true } })).rejects.toThrow(
      /Job "HookedJob" declares hooks \(audit\(\) on tools:call-tool\), but jobs do not run through a hookable flow/,
    );
  });

  it('still starts with class hooks that run on the instance, and runs them', async () => {
    const ran: string[] = [];

    @Tool({ name: 'fine_tool', inputSchema: {} })
    class FineTool extends ToolContext {
      @ToolHook.Did('createToolCallContext')
      built() {
        ran.push('did:createToolCallContext');
      }

      @ToolHook.Will('execute')
      before() {
        ran.push('will:execute');
      }

      async execute() {
        return {};
      }
    }
    @Resource({ name: 'fine', uri: 'fine://one' })
    class FineResource extends ResourceContext {
      @ResourceHook.Will('execute')
      before() {
        ran.push('resource:will:execute');
      }

      async execute(uri: string): Promise<ReadResourceResult> {
        return { contents: [{ uri, text: '' }] };
      }
    }
    @App({ id: 'fine', name: 'Fine', tools: [FineTool], resources: [FineResource] })
    class FineApp {}

    const server = await FrontMcpInstance.createDirect({
      info: { name: 'entry-class-hooks', version: '1.0.0' },
      apps: [FineApp],
      logging: { level: LogLevel.Off },
    });
    try {
      await server.callTool('fine_tool', {});
      await server.readResource('fine://one');
    } finally {
      await server.dispose();
    }

    expect(ran).toEqual(['did:createToolCallContext', 'will:execute', 'resource:will:execute']);
  });
});

/**
 * The answer budget, the client profiles and the cost meter, through the tools/call,
 * resources/read, resources/list and tools/list flows of a connected client.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';
import type { CallToolResult } from '@frontmcp/protocol';

import {
  App,
  FlowHooksOf,
  LogLevel,
  Plugin,
  Resource,
  ResourceContext,
  Skill,
  SkillContext,
  Tool,
  ToolContext,
  type FlowCtxOf,
} from '../../common';
import { connect } from '../../direct';
import type { DirectClient } from '../../direct/client.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../../scope/scope.instance';
import { composeCallerInstructions } from '../../skill/skill-instructions.helper';
import { ANSWER_COUNTERS, BUDGET_META_KEY } from '../index';

const counted: Array<{ name: string; by: number; attributes: Record<string, string> }> = [];

jest.mock('@frontmcp/observability', () => ({
  createCounter: (name: string) => ({
    inc: (by: number, attributes: Record<string, string>) => counted.push({ name, by, attributes }),
  }),
}));

function events(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: index, message: `event ${index} `.padEnd(200, '.') }));
}

const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

@Tool({
  name: 'list_events',
  inputSchema: { count: z.number() },
  outputSchema: { events: z.array(z.object({ id: z.number(), message: z.string() })), total: z.number() },
})
class ListEventsTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { events: events(count), total: count };
  }
}

@Tool({ name: 'raw_events', inputSchema: { count: z.number() } })
class RawEventsTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { events: events(count) };
  }
}

@Tool({ name: 'all_events', inputSchema: { count: z.number() }, output: { budget: false } })
class AllEventsTool extends ToolContext {
  async execute({ count }: { count: number }) {
    return { events: events(count) };
  }
}

@Tool({ name: 'count_events', inputSchema: {} })
class CountEventsTool extends ToolContext {
  async execute() {
    const inner = await this.callTool('raw_events', { count: 1000 });
    return { counted: (inner.structuredContent as { events: unknown[] }).events.length };
  }
}

@Resource({ name: 'event-log', uri: 'data://events', mimeType: 'application/json' })
class EventLogResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ events: events(1000) }) }] };
  }
}

@Resource({ name: 'ranked', uri: 'data://ranked', annotations: { audience: ['user'], priority: 0.5 } })
class RankedResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'ranked' }] };
  }
}

@Skill({ name: 'triage', description: 'Triage incoming events', instructions: 'Read the events, then triage.' })
class TriageSkill extends SkillContext {}

@App({
  id: 'events',
  name: 'Events',
  tools: [ListEventsTool, RawEventsTool, AllEventsTool, CountEventsTool],
  resources: [EventLogResource, RankedResource],
  skills: [TriageSkill],
})
class EventsApp {}

const serverConfig = {
  info: { name: 'answer-shaping', version: '1.0.0' },
  apps: [EventsApp],
  logging: { level: LogLevel.Off },
  output: { budget: { maxBytes: 20_000 } },
  metrics: { enabled: true },
  clients: {
    'summary-agent': { structured: 'only' as const },
    'text-agent': { structured: 'text' as const, annotations: 'no-numbers' as const },
    'full-agent': { annotations: 'full' as const, instructions: 'full' as const },
  },
};

async function clientNamed(name: string): Promise<DirectClient> {
  return connect(serverConfig, { clientInfo: { name, version: '1.0.0' } });
}

describe('answer shaping through the flows', () => {
  const clients: DirectClient[] = [];
  const open = async (name: string) => {
    const client = await clientNamed(name);
    clients.push(client);
    return client;
  };

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close()));
  });

  describe('the answer budget', () => {
    it('fits a large tool answer to output.budget as valid JSON and notes what it left out', async () => {
      const client = await open('acme-agent');
      const result = (await client.callTool('list_events', { count: 1000 })) as CallToolResult;

      const structured = result.structuredContent as { events: Array<{ id: number }>; total: number };
      expect(bytesOf(structured)).toBeLessThanOrEqual(20_000);
      expect(structured.total).toBe(1000);
      expect(structured.events[structured.events.length - 1].id).toBe(999);
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(structured);
      expect((result.content[1] as { text: string }).text).toMatch(
        /^This answer was shortened to fit its 20000-byte budget/,
      );
      expect(result._meta?.[BUDGET_META_KEY]).toMatchObject({
        maxBytes: 20_000,
        omitted: [{ path: '$.events', of: 1000 }],
      });
    });

    it('leaves a tool whose output.budget is false alone', async () => {
      const client = await open('acme-agent');
      const result = (await client.callTool('all_events', { count: 1000 })) as CallToolResult;
      expect((result.structuredContent as { events: unknown[] }).events).toHaveLength(1000);
      expect(result._meta?.[BUDGET_META_KEY]).toBeUndefined();
    });

    it('leaves an answer a tool gets from this.callTool() alone', async () => {
      const client = await open('acme-agent');
      const result = (await client.callTool('count_events', {})) as CallToolResult;
      expect(result.structuredContent).toEqual({ counted: 1000 });
    });

    it('fits a resource read', async () => {
      const client = await open('acme-agent');
      const result = await client.readResource('data://events');
      const text = (result.contents[0] as { text: string }).text;
      expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(20_000);
      expect(JSON.parse(text)).toHaveProperty('events');
      expect((result.contents[1] as { text: string }).text).toMatch(/^This answer was shortened/);
      expect(result._meta?.[BUDGET_META_KEY]).toMatchObject({ omitted: [{ uri: 'data://events', path: '$.events' }] });
    });
  });

  describe('client profiles', () => {
    it('sends a one-line summary in place of the JSON to a structured: only client', async () => {
      const client = await open('summary-agent');
      await client.listTools();
      const result = (await client.callTool('list_events', { count: 3 })) as CallToolResult;
      expect(result.content).toEqual([
        { type: 'text', text: 'The answer is in structuredContent: events (3 items), total: 3.' },
      ]);
      expect((result.structuredContent as { total: number }).total).toBe(3);
    });

    it('answers a tool without an output schema with both to a structured: only client', async () => {
      const client = await open('summary-agent');
      const result = (await client.callTool('raw_events', { count: 1 })) as CallToolResult;
      expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
    });

    it('sends text only to a structured: text client, and lists no outputSchema to it', async () => {
      const client = await open('text-agent');
      const listed = await client.listTools();
      const listEvents = (listed as Array<{ name: string; outputSchema?: unknown }>).find(
        (tool) => tool.name === 'list_events',
      );
      expect(listEvents?.outputSchema).toBeUndefined();

      const result = (await client.callTool('list_events', { count: 2 })) as CallToolResult;
      expect(result.structuredContent).toBeUndefined();
      expect(JSON.parse((result.content[0] as { text: string }).text)).toMatchObject({ total: 2 });
    });

    it('still lists the outputSchema to other clients', async () => {
      const client = await open('acme-agent');
      const listed = await client.listTools();
      const listEvents = (listed as Array<{ name: string; outputSchema?: unknown }>).find(
        (tool) => tool.name === 'list_events',
      );
      expect(listEvents?.outputSchema).toBeDefined();
    });

    it('drops numeric resource annotations for an annotations: no-numbers client', async () => {
      const textClient = await open('text-agent');
      const otherClient = await open('acme-agent');
      const annotationsOf = async (client: DirectClient, uri: string) =>
        (await client.listResources()).resources.find((resource) => resource.uri === uri)?.annotations;

      expect(await annotationsOf(textClient, 'data://ranked')).toEqual({ audience: ['user'] });
      expect(await annotationsOf(otherClient, 'data://ranked')).toEqual({ audience: ['user'], priority: 0.5 });
    });

    it('gives a skill its priority for an annotations: full client', async () => {
      const fullClient = await open('full-agent');
      const otherClient = await open('acme-agent');
      const skillAnnotationsOf = async (client: DirectClient) =>
        (await client.listResources()).resources.find((resource) => resource.uri === 'skill://triage/SKILL.md')
          ?.annotations;

      expect(await skillAnnotationsOf(fullClient)).toMatchObject({ audience: ['assistant'], priority: 0.8 });
      expect((await skillAnnotationsOf(otherClient))?.priority).toBeUndefined();
    });

    it('sends the skill catalog to an instructions: full client and the compact line to others', async () => {
      const [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes();
      const full = await composeCallerInstructions(scope as Scope, { ctx: { authInfo: {} }, clientName: 'full-agent' });
      const compact = await composeCallerInstructions(scope as Scope, {
        ctx: { authInfo: {} },
        clientName: 'acme-agent',
      });

      expect(full).toContain('- **triage**: Triage incoming events');
      expect(compact).toContain('This server has 1 skill');
      expect(compact).not.toContain('**triage**');
    });
  });

  describe('the cost meter', () => {
    it('counts answer bytes, estimated tokens and duplicated bytes per tool and client platform', async () => {
      counted.length = 0;
      const client = await open('codex-mcp-client');
      const result = (await client.callTool('list_events', { count: 2 })) as CallToolResult;

      const bytes = bytesOf(result);
      const labels = { tool: 'events:list_events', client: 'codex' };
      expect(counted).toEqual([
        { name: ANSWER_COUNTERS.bytes, by: bytes, attributes: labels },
        { name: ANSWER_COUNTERS.estimatedTokens, by: Math.ceil(bytes / 4), attributes: labels },
        { name: ANSWER_COUNTERS.duplicatedBytes, by: bytesOf(result.structuredContent), attributes: labels },
      ]);
    });
  });
});

const ToolHook = FlowHooksOf('tools:call-tool');

/** Replaces the budget with a fold of its own, as a result-handles plugin would. */
@Plugin({ name: 'fold-answers' })
class FoldAnswersPlugin {
  @ToolHook.Around('fitAnswer')
  async foldAnswer(flowCtx: FlowCtxOf<'tools:call-tool'>) {
    const folded = { content: [{ type: 'text' as const, text: 'folded' }], structuredContent: { folded: true } };
    flowCtx.state.set('output', folded);
    flowCtx.respond(folded);
  }
}

@App({ id: 'folded', name: 'Folded', tools: [RawEventsTool], plugins: [FoldAnswersPlugin] })
class FoldedApp {}

describe('a plugin that replaces the fitAnswer stage', () => {
  it('answers in place of the budget', async () => {
    const client = await connect(
      { ...serverConfig, info: { name: 'folded-answers', version: '1.0.0' }, apps: [FoldedApp] },
      { clientInfo: { name: 'acme-agent', version: '1.0.0' } },
    );
    try {
      const result = (await client.callTool('raw_events', { count: 1000 })) as CallToolResult;
      expect(result.structuredContent).toEqual({ folded: true });
      expect(result._meta?.[BUDGET_META_KEY]).toBeUndefined();
    } finally {
      await client.close();
    }
  });
});

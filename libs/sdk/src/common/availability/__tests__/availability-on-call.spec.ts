import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import {
  createTestFetchServer,
  rpc20260728,
  type JsonRpcMessage,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { connect } from '../../../direct';
import {
  Agent,
  AgentContext,
  App,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Tool,
  ToolContext,
  type ResourceCompletionResult,
} from '../../index';

/**
 * `availableWhen` gates every path that finds an entry by name, not only the listings.
 *
 * `surface` is the per-call axis: an entry offered only to agents (or the CLI) must be absent from
 * an MCP client's listings and answer that client like an entry that doesn't exist. The
 * process-wide axes (os, runtime, env, ...) already hid entries from listings, but
 * `resources/read`, `prompts/get` and `completion/complete` still served them by name.
 */

const runs: string[] = [];

function text(uri: string): ReadResourceResult {
  return { contents: [{ uri, text: `content of ${uri}` }] };
}

function prompt(textValue: string): GetPromptResult {
  return { messages: [{ role: 'user', content: { type: 'text', text: textValue } }] };
}

@Tool({ name: 'open_tool', inputSchema: {} })
class OpenTool extends ToolContext {
  async execute() {
    runs.push('open_tool');
    return { ran: 'open_tool' };
  }
}

@Tool({ name: 'agent_only_tool', inputSchema: {}, availableWhen: { surface: ['agent'] } })
class AgentOnlyTool extends ToolContext {
  async execute() {
    runs.push('agent_only_tool');
    return { ran: 'agent_only_tool' };
  }
}

@Tool({ name: 'cli_only_tool', inputSchema: {}, availableWhen: { surface: ['cli'] } })
class CliOnlyTool extends ToolContext {
  async execute() {
    runs.push('cli_only_tool');
    return { ran: 'cli_only_tool' };
  }
}

/** Composes with the agent-only helper in process, which no surface restriction applies to. */
@Tool({ name: 'use_helper', inputSchema: {} })
class UseHelperTool extends ToolContext {
  async execute() {
    const result = await this.callTool('agent_only_tool', {});
    return { helper: result.isError ? 'refused' : 'ran' };
  }
}

/** Offered only to agents on the edge runtime, so it is unavailable in this (Node) process. */
@Tool({ name: 'edge_agent_tool', inputSchema: {}, availableWhen: { runtime: ['edge'], surface: ['agent'] } })
class EdgeAgentTool extends ToolContext {
  async execute() {
    runs.push('edge_agent_tool');
    return { ran: 'edge_agent_tool' };
  }
}

/** Calls the edge-only tool in process and reports how the call was refused. */
@Tool({ name: 'use_edge_helper', inputSchema: {} })
class UseEdgeHelperTool extends ToolContext {
  async execute() {
    try {
      const result = await this.callTool('edge_agent_tool', {});
      return { refusal: String(result.content?.[0] && 'text' in result.content[0] ? result.content[0].text : '') };
    } catch (error) {
      return { refusal: error instanceof Error ? error.message : String(error) };
    }
  }
}

@Agent({
  name: 'agent_only_agent',
  description: 'Offered to other agents only',
  inputSchema: {},
  llm: { adapter: { completion: jest.fn().mockResolvedValue({ content: 'done', finishReason: 'stop' }) } },
  availableWhen: { surface: ['agent'] },
})
class AgentOnlyAgent extends AgentContext {
  override async execute(_input: Record<string, never>) {
    runs.push('agent_only_agent');
    return { ran: 'agent_only_agent' };
  }
}

@Resource({ name: 'open-notes', uri: 'open://notes' })
class OpenNotes extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'agent-notes', uri: 'agent://notes', availableWhen: { surface: ['agent'] } })
class AgentNotes extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@Resource({ name: 'edge-notes', uri: 'edge://notes', availableWhen: { runtime: ['edge'] } })
class EdgeNotes extends ResourceContext {
  async execute(uri: string) {
    return text(uri);
  }
}

@ResourceTemplate({ name: 'agent-note', uriTemplate: 'agent://note/{noteId}', availableWhen: { surface: ['agent'] } })
class AgentNote extends ResourceContext<{ noteId: string }> {
  async noteIdCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['agent-note-1'] };
  }

  async execute(uri: string) {
    return text(uri);
  }
}

@ResourceTemplate({ name: 'edge-note', uriTemplate: 'edge://note/{noteId}', availableWhen: { runtime: ['edge'] } })
class EdgeNote extends ResourceContext<{ noteId: string }> {
  async noteIdCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['edge-note-1'] };
  }

  async execute(uri: string) {
    return text(uri);
  }
}

@ResourceTemplate({ name: 'open-note', uriTemplate: 'open://note/{noteId}' })
class OpenNote extends ResourceContext<{ noteId: string }> {
  async noteIdCompleter(): Promise<ResourceCompletionResult> {
    return { values: ['open-note-1'] };
  }

  async execute(uri: string) {
    return text(uri);
  }
}

@Prompt({ name: 'open-prompt', arguments: [] })
class OpenPrompt extends PromptContext {
  async execute() {
    return prompt('open prompt');
  }
}

@Prompt({ name: 'agent-prompt', arguments: [], availableWhen: { surface: ['agent'] } })
class AgentPrompt extends PromptContext {
  async execute() {
    return prompt('agent prompt');
  }
}

@Prompt({ name: 'edge-prompt', arguments: [], availableWhen: { runtime: ['edge'] } })
class EdgePrompt extends PromptContext {
  async execute() {
    return prompt('edge prompt');
  }
}

@App({
  id: 'desk',
  name: 'Desk',
  tools: [OpenTool, AgentOnlyTool, CliOnlyTool, UseHelperTool, EdgeAgentTool, UseEdgeHelperTool],
  agents: [AgentOnlyAgent],
  resources: [OpenNotes, AgentNotes, EdgeNotes, AgentNote, EdgeNote, OpenNote],
  prompts: [OpenPrompt, AgentPrompt, EdgePrompt],
})
class DeskApp {}

const serverConfig = { info: { name: 'availability-on-call', version: '1.0.0' }, apps: [DeskApp] };

/** What a caller learns from an answer, with the entry's own name taken out. */
function answerShape(message: JsonRpcMessage, name: string): Record<string, unknown> {
  const redact = (value: unknown) => (typeof value === 'string' ? value.split(name).join('<entry>') : value);
  if (message.error) return { error: message.error.code, message: redact(message.error.message) };
  const result = message.result ?? {};
  if (result['isError'] === true) {
    const content = result['content'] as Array<{ text?: string }> | undefined;
    const meta = result['_meta'] as Record<string, unknown> | undefined;
    return { isError: true, code: meta?.['code'], text: redact(content?.[0]?.text) };
  }
  return { result: 'served' };
}

describe('availableWhen on the MCP call paths', () => {
  let server: TestFetchServer;

  beforeAll(async () => {
    server = await createTestFetchServer(serverConfig);
  });

  beforeEach(() => {
    runs.length = 0;
  });

  async function request(method: string, params: Record<string, unknown> = {}): Promise<JsonRpcMessage> {
    return (await rpc20260728(server.handler, method, params)).message;
  }

  async function names(method: string, key: string, field: 'name' | 'uri' | 'uriTemplate'): Promise<string[]> {
    const message = await request(method);
    return ((message.result?.[key] as Array<Record<string, string>> | undefined) ?? []).map((entry) => entry[field]);
  }

  async function completions(uri: string): Promise<string[]> {
    const message = await request('completion/complete', {
      ref: { type: 'ref/resource', uri },
      argument: { name: 'noteId', value: '' },
    });
    return ((message.result?.['completion'] as { values?: string[] } | undefined)?.values ?? []).slice();
  }

  describe('surface', () => {
    it('leaves entries not offered on MCP out of every listing', async () => {
      const listed = {
        tools: await names('tools/list', 'tools', 'name'),
        resources: await names('resources/list', 'resources', 'uri'),
        templates: await names('resources/templates/list', 'resourceTemplates', 'uriTemplate'),
        prompts: await names('prompts/list', 'prompts', 'name'),
      };

      expect({
        tools: ['agent_only_tool', 'cli_only_tool', 'invoke_agent_only_agent'].filter((n) => listed.tools.includes(n)),
        resources: listed.resources.filter((uri) => uri.startsWith('agent://')),
        templates: listed.templates.filter((uri) => uri.startsWith('agent://')),
        prompts: listed.prompts.filter((name) => name === 'agent-prompt'),
      }).toEqual({ tools: [], resources: [], templates: [], prompts: [] });
      expect(listed.tools).toEqual(expect.arrayContaining(['open_tool', 'use_helper']));
      expect(listed.resources).toContain('open://notes');
      expect(listed.templates).toContain('open://note/{noteId}');
      expect(listed.prompts).toContain('open-prompt');
    });

    it('answers tools/call on a tool or agent not offered on MCP like an unknown tool', async () => {
      const unknown = answerShape(await request('tools/call', { name: 'no_such_tool', arguments: {} }), 'no_such_tool');

      const answers = {
        agentOnlyTool: answerShape(
          await request('tools/call', { name: 'agent_only_tool', arguments: {} }),
          'agent_only_tool',
        ),
        cliOnlyTool: answerShape(
          await request('tools/call', { name: 'cli_only_tool', arguments: {} }),
          'cli_only_tool',
        ),
        agentOnlyAgent: answerShape(
          await request('tools/call', { name: 'invoke_agent_only_agent', arguments: {} }),
          'invoke_agent_only_agent',
        ),
      };

      expect(answers).toEqual({ agentOnlyTool: unknown, cliOnlyTool: unknown, agentOnlyAgent: unknown });
      expect(runs).toEqual([]);
    });

    it('answers resources/read on a resource or template not offered on MCP like an unknown resource', async () => {
      const unknown = answerShape(await request('resources/read', { uri: 'nothing://here' }), 'nothing://here');

      expect({
        resource: answerShape(await request('resources/read', { uri: 'agent://notes' }), 'agent://notes'),
        template: answerShape(await request('resources/read', { uri: 'agent://note/1' }), 'agent://note/1'),
      }).toEqual({ resource: unknown, template: unknown });
    });

    it('answers prompts/get on a prompt not offered on MCP like an unknown prompt', async () => {
      const unknown = answerShape(await request('prompts/get', { name: 'no-such-prompt' }), 'no-such-prompt');

      expect(answerShape(await request('prompts/get', { name: 'agent-prompt' }), 'agent-prompt')).toEqual(unknown);
    });

    it('completes nothing for a template not offered on MCP, like an unknown one', async () => {
      expect({
        agent: await completions('agent://note/{noteId}'),
        unknown: await completions('nothing://note/{noteId}'),
        open: await completions('open://note/{noteId}'),
      }).toEqual({ agent: [], unknown: [], open: ['open-note-1'] });
    });

    it('still lets a tool compose with an agent-only tool in process', async () => {
      const message = await request('tools/call', { name: 'use_helper', arguments: {} });

      expect(message.result?.['structuredContent']).toEqual({ helper: 'ran' });
      expect(runs).toEqual(['agent_only_tool']);
    });
  });

  describe('process-wide axes', () => {
    it('refuses resources/read, prompts/get and completion for entries unavailable in this runtime', async () => {
      const answers = {
        resource: answerShape(await request('resources/read', { uri: 'edge://notes' }), 'edge://notes'),
        template: answerShape(await request('resources/read', { uri: 'edge://note/1' }), 'edge://note/1'),
        prompt: answerShape(await request('prompts/get', { name: 'edge-prompt' }), 'edge-prompt'),
      };

      const unavailable = {
        error: -32003,
        message: expect.stringContaining('is not available in the current environment'),
      };
      expect(answers).toEqual({ resource: unavailable, template: unavailable, prompt: unavailable });
      expect(await completions('edge://note/{noteId}')).toEqual([]);
    });

    it('reports an in-process call refused by a process-wide axis without a surface it never had', async () => {
      const message = await request('tools/call', { name: 'use_edge_helper', arguments: {} });
      const refusal = (message.result?.['structuredContent'] as { refusal?: string } | undefined)?.refusal ?? '';

      expect(refusal).toContain('is not available in the current environment');
      expect(refusal).toContain('(missing axes: runtime)');
      expect(refusal).not.toMatch(/\(current: [^)]*"surface"/);
      expect(runs).toEqual([]);
    });

    it('still serves entries without a constraint', async () => {
      expect({
        tool: answerShape(await request('tools/call', { name: 'open_tool', arguments: {} }), 'open_tool'),
        resource: answerShape(await request('resources/read', { uri: 'open://notes' }), 'open://notes'),
        template: answerShape(await request('resources/read', { uri: 'open://note/1' }), 'open://note/1'),
        prompt: answerShape(await request('prompts/get', { name: 'open-prompt' }), 'open-prompt'),
      }).toEqual({
        tool: { result: 'served' },
        resource: { result: 'served' },
        template: { result: 'served' },
        prompt: { result: 'served' },
      });
    });
  });
});

/** A direct client's tools/call answer, with the tool's own name taken out. */
function toolAnswer(result: unknown, name: string): Record<string, unknown> {
  const answer = result as { isError?: boolean; content?: Array<{ text?: string }>; _meta?: Record<string, unknown> };
  if (answer.isError !== true) return { result: 'served' };
  return { isError: true, code: answer._meta?.['code'], text: answer.content?.[0]?.text?.split(name).join('<entry>') };
}

describe('availableWhen.surface for the in-process CLI client', () => {
  beforeEach(() => {
    runs.length = 0;
  });

  it('calls entries offered on the CLI and refuses the rest like unknown ones', async () => {
    const client = await connect(serverConfig, { mode: 'cli' });
    try {
      const listed = JSON.stringify(await client.listTools());
      const cliOnly = JSON.stringify(await client.callTool('cli_only_tool', {}));
      const agentOnly = toolAnswer(await client.callTool('agent_only_tool', {}), 'agent_only_tool');
      const unknown = toolAnswer(await client.callTool('no_such_tool', {}), 'no_such_tool');

      expect({
        listsCliOnly: listed.includes('"cli_only_tool"'),
        listsAgentOnly: listed.includes('"agent_only_tool"'),
        cliOnly: cliOnly.includes('cli_only_tool') && !cliOnly.includes('"isError":true'),
        agentOnly,
      }).toEqual({ listsCliOnly: true, listsAgentOnly: false, cliOnly: true, agentOnly: unknown });
      expect(runs).toEqual(['cli_only_tool']);
    } finally {
      await client.close();
    }
  });
});

import { z } from '@frontmcp/lazy-zod';
import {
  Agent,
  AgentContext,
  FlowHooksOf,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  type AgentLlmAdapter,
  type FlowCtxOf,
} from '@frontmcp/sdk';

/** URIs whose read the agent's own plugin saw, newest last; `read_audit` reports them. */
const auditedReads: string[] = [];

/**
 * Mock LLM adapter: calls the tool its input names (`{ tool, args }`), then answers with the tool
 * message it read, as `{ "read": "...", "tools": [...] }` (the tools it was offered).
 */
const mockLibrarianAdapter: AgentLlmAdapter = {
  async completion(prompt, tools) {
    const offered = (tools ?? []).map((tool) => tool.name).sort();
    const last = prompt.messages[prompt.messages.length - 1];
    if (last?.role === 'tool') {
      return {
        content: JSON.stringify({ read: last.content ?? '', tools: offered, audited: [...auditedReads] }),
        finishReason: 'stop',
      };
    }
    const request = JSON.parse(prompt.messages[0]?.content ?? '{}') as { tool: string; args?: Record<string, unknown> };
    return {
      content: null,
      finishReason: 'tool_calls',
      toolCalls: [{ id: 'librarian-call', name: request.tool, arguments: request.args ?? {} }],
    };
  },
};

@Resource({ name: 'shelf', uri: 'library://shelf', mimeType: 'text/plain', description: 'What is on the shelf' })
class ShelfResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'three books' }] };
  }
}

@ResourceTemplate({ name: 'book', uriTemplate: 'library://books/{id}', mimeType: 'text/plain' })
class BookResource extends ResourceContext<{ id: string }> {
  async execute(uri: string, { id }: { id: string }) {
    return { contents: [{ uri, text: `Book ${id}` }] };
  }
}

@Prompt({ name: 'greeting', arguments: [{ name: 'visitor', required: true }] })
class GreetingPrompt extends PromptContext {
  async execute(args: Record<string, string>) {
    return {
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: `Welcome, ${args['visitor']}` } }],
    };
  }
}

const ReadResourceHook = FlowHooksOf('resources:read-resource');

/** Installed on the agent: its hook runs in the agent's scope when the model reads a resource. */
@Plugin({ name: 'library-read-audit' })
class LibraryReadAuditPlugin {
  @ReadResourceHook.Will('execute')
  audit(ctx: FlowCtxOf<'resources:read-resource'>) {
    auditedReads.push(ctx.state.input?.uri ?? '');
  }
}

/**
 * Librarian Agent for testing an agent's model reading the agent's resources and prompts (#699).
 *
 * None of them is exported, so clients don't see them; the model reads them with the built-in
 * `list_resources`, `read_resource`, `list_prompts` and `get_prompt` tools.
 */
@Agent({
  id: 'librarian-agent',
  name: 'librarian-agent',
  description: 'An agent whose model reads the library resources and prompts',
  inputSchema: {
    tool: z.string().describe('The tool the mock model calls'),
    args: z.record(z.string(), z.unknown()).optional().describe('Its arguments'),
  },
  outputSchema: z.object({ read: z.string(), tools: z.array(z.string()), audited: z.array(z.string()) }),
  llm: { adapter: mockLibrarianAdapter },
  resources: [ShelfResource, BookResource],
  prompts: [GreetingPrompt],
  plugins: [LibraryReadAuditPlugin],
})
export class LibrarianAgent extends AgentContext {}

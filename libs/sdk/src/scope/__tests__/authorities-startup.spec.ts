import 'reflect-metadata';

import { createTestFetchServer, rpc20260728 } from '../../__test-utils__/helpers/mcp-20260728.helpers';
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
  type FrontMcpConfigInput,
  type PromptMetadata,
  type ResourceMetadata,
} from '../../common';

/**
 * An entry that declares `authorities` on a server that cannot enforce them must stop the
 * server from starting, whatever kind of entry it is (#265): otherwise it is readable by anyone.
 */

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}', mimeType: 'text/plain', authorities: 'admin' })
class TicketTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'secret' }] };
  }
}

// `hideFromDiscovery` is read at run time but not declared on the resource and prompt metadata types.
@Resource({ name: 'audit', uri: 'audit://log', hideFromDiscovery: true, authorities: 'admin' } as ResourceMetadata)
class HiddenAuditResource extends ResourceContext {
  async execute(uri: string) {
    return { contents: [{ uri, text: 'secret' }] };
  }
}

@Prompt({ name: 'escalate', arguments: [], hideFromDiscovery: true, authorities: 'admin' } as PromptMetadata)
class HiddenEscalatePrompt extends PromptContext {
  async execute() {
    return { messages: [] };
  }
}

@Tool({ name: 'lookup_order', inputSchema: {}, authorities: 'admin' })
class LookupOrderTool extends ToolContext {
  async execute() {
    return {};
  }
}

@Agent({
  name: 'triage',
  inputSchema: {},
  llm: { adapter: { completion: async () => ({ content: 'done', finishReason: 'stop' as const }) } },
  tools: [LookupOrderTool],
})
class TriageAgent extends AgentContext {}

function serverWith(app: Record<string, unknown>): FrontMcpConfigInput {
  @App({ id: 'desk', name: 'Desk', ...app })
  class DeskApp {}
  return { info: { name: 'authorities-startup', version: '1.0.0' }, apps: [DeskApp] };
}

describe('startup check for entries with authorities on a server without the authorities option', () => {
  it.each([
    ['a resource template', { resources: [TicketTemplate] }, /Resource template "ticket"/],
    ['a hidden resource', { resources: [HiddenAuditResource] }, /Resource "audit"/],
    ['a hidden prompt', { prompts: [HiddenEscalatePrompt] }, /Prompt "escalate"/],
    ['a tool of an agent', { agents: [TriageAgent] }, /Tool "triage:lookup_order"/],
  ])('refuses to start with %s', async (_label, app, entry) => {
    const startup = createTestFetchServer(serverWith(app));

    await expect(startup).rejects.toThrow(/Authorities configuration required/);
    await expect(startup).rejects.toThrow(entry);
  });
});

describe('a resource template with authorities on a server with the authorities option', () => {
  it('is refused to a caller the rule refuses', async () => {
    const server = await createTestFetchServer({
      ...serverWith({ resources: [TicketTemplate] }),
      authorities: { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } },
    });

    const { message } = await rpc20260728(server.handler, 'resources/read', { uri: 'tickets://T-1' });

    expect(message.error).toMatchObject({ code: -32003 });
    expect(JSON.stringify(message)).not.toContain('secret');
  });
});

/**
 * A rule that checks nothing must not let everyone in (#266): it is refused when the server
 * starts, in an entry's `authorities` and in a profile alike.
 */
describe('startup check for rules that check nothing', () => {
  const authorities = {
    claimsMapping: { roles: 'roles' },
    profiles: { admin: { roles: { any: ['admin'] } } },
  };

  function serverWithRule(rule: unknown, profiles: Record<string, unknown> = {}): FrontMcpConfigInput {
    @Tool({ name: 'delete_ticket', inputSchema: {}, authorities: rule as 'admin' })
    class DeleteTicketTool extends ToolContext {
      async execute() {
        return { deleted: true };
      }
    }
    return {
      ...serverWith({ tools: [DeleteTicketTool] }),
      authorities: { ...authorities, profiles: { ...authorities.profiles, ...profiles } },
    };
  }

  it.each([
    ['an empty rule', {}, /Tool "delete_ticket".*checks nothing/],
    ['roles with neither all nor any', { roles: {} }, /Tool "delete_ticket".*roles.*"all" or "any"/],
    ['an empty allOf', { allOf: [] }, /Tool "delete_ticket".*allOf.*empty/],
    ['a misspelled field', { role: { any: ['admin'] } }, /Tool "delete_ticket".*unknown field "role"/],
    ['an empty roles.all', { roles: { all: [] } }, /Tool "delete_ticket".*roles\.all.*empty/],
    ['a rule with only an operator', { operator: 'OR' }, /Tool "delete_ticket".*checks nothing/],
    ['an empty rule inside not', { not: {} }, /Tool "delete_ticket".*not.*checks nothing/],
  ])('refuses to start with %s', async (_label, rule, problem) => {
    const startup = createTestFetchServer(serverWithRule(rule));

    await expect(startup).rejects.toThrow(/Invalid authorities rule/);
    await expect(startup).rejects.toThrow(problem);
  });

  it('refuses to start with a profile that checks nothing', async () => {
    const startup = createTestFetchServer(serverWithRule('open', { open: {} }));

    await expect(startup).rejects.toThrow(/Invalid authorities rule/);
    await expect(startup).rejects.toThrow(/profile "open".*checks nothing/);
  });

  it('refuses to start with a profile name inside a combinator', async () => {
    const startup = createTestFetchServer(serverWithRule({ anyOf: ['admin'] }));

    await expect(startup).rejects.toThrow(
      /Tool "delete_ticket": authorities\.anyOf\[0\] must be a rule object, not a profile name/,
    );
  });

  it('starts with rules that check something', async () => {
    const server = await createTestFetchServer(
      serverWithRule({ anyOf: [{ roles: { any: ['admin'] } }, { not: { permissions: { all: ['banned'] } } }] }),
    );

    expect(server.handler).toBeInstanceOf(Function);
  });
});

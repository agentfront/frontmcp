/**
 * A 2026-07-28 result that may differ from caller to caller is never marked `cacheScope: 'public'`.
 *
 * Anonymous results were marked `public`, so a shared cache could serve them to every caller. But a
 * list is shaped per caller whenever `authorities` rules filter it, or a plugin hooks the flow that
 * builds it: feature flags, skill visibility, or any custom filter. `server/discover` carries the
 * skill catalog built for the caller. Such a result served from a shared cache shows one caller
 * what was filtered for another.
 */
import 'reflect-metadata';

import { type GetPromptResult, type ReadResourceResult } from '@frontmcp/protocol';

import { createTestFetchServer, rpc20260728 } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import {
  App,
  FlowHooksOf,
  Plugin,
  Prompt,
  PromptContext,
  Resource,
  ResourceContext,
  ResourceTemplate,
  Skill,
  Tool,
  ToolContext,
  type FrontMcpConfigInput,
} from '../../../common';

@Tool({ name: 'lookup_order', inputSchema: {} })
class LookupOrderTool extends ToolContext {
  async execute() {
    return { order: 'o-1' };
  }
}

@Tool({ name: 'refund_order', inputSchema: {}, authorities: 'admin' })
class RefundOrderTool extends ToolContext {
  async execute() {
    return { refunded: true };
  }
}

@Resource({ name: 'status', uri: 'status://desk' })
class StatusResource extends ResourceContext {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'open' }] };
  }
}

@ResourceTemplate({ name: 'ticket', uriTemplate: 'tickets://{id}' })
class TicketTemplate extends ResourceContext<{ id: string }> {
  async execute(uri: string): Promise<ReadResourceResult> {
    return { contents: [{ uri, text: 'ticket' }] };
  }
}

@Prompt({ name: 'summary', arguments: [] })
class SummaryPrompt extends PromptContext {
  async execute(): Promise<GetPromptResult> {
    return { messages: [] };
  }
}

@Skill({ name: 'triage', description: 'Triage tickets', instructions: 'Triage steps.' })
class TriageSkill {}

const ListToolsHook = FlowHooksOf('tools:list-tools');
const ListResourcesHook = FlowHooksOf('resources:list-resources');
const ListTemplatesHook = FlowHooksOf('resources:list-resource-templates');
const ListPromptsHook = FlowHooksOf('prompts:list-prompts');
const FilterSkillsHook = FlowHooksOf('skills:filter');

/** Filters every list for the caller, the way a feature-flag or visibility plugin does. */
@Plugin({ name: 'per-caller-lists' })
class PerCallerListsPlugin {
  @ListToolsHook.Did('findTools')
  filterTools() {
    // a per-caller decision would go here
  }

  @ListResourcesHook.Did('findResources')
  filterResources() {
    // a per-caller decision would go here
  }

  @ListTemplatesHook.Did('findTemplates')
  filterTemplates() {
    // a per-caller decision would go here
  }

  @ListPromptsHook.Did('findPrompts')
  filterPrompts() {
    // a per-caller decision would go here
  }

  @FilterSkillsHook.Did('filterSkills')
  filterSkills() {
    // a per-caller decision would go here
  }
}

function config(app: Record<string, unknown>, extra: Partial<FrontMcpConfigInput> = {}): FrontMcpConfigInput {
  @App({
    id: 'desk',
    name: 'Desk',
    tools: [LookupOrderTool],
    resources: [StatusResource, TicketTemplate],
    prompts: [SummaryPrompt],
    skills: [TriageSkill],
    ...app,
  })
  class DeskApp {}
  return { info: { name: 'cache-scope', version: '1.0.0' }, apps: [DeskApp], ...extra };
}

const RESULTS: Array<[string, Record<string, unknown>]> = [
  ['tools/list', {}],
  ['resources/list', {}],
  ['resources/templates/list', {}],
  ['prompts/list', {}],
  ['server/discover', {}],
];

async function cacheScopeOf(server: Awaited<ReturnType<typeof createTestFetchServer>>, method: string) {
  const { message } = await rpc20260728(server.handler, method, {});
  return message.result?.['cacheScope'];
}

describe('cacheScope of anonymous 2026-07-28 results', () => {
  it.each(RESULTS)('%s is private when a plugin hooks the flow that builds it', async (method) => {
    const server = await createTestFetchServer(config({ plugins: [PerCallerListsPlugin] }));

    expect(await cacheScopeOf(server, method)).toBe('private');
  });

  it.each(RESULTS)('%s is private on a server that filters by authorities', async (method) => {
    const server = await createTestFetchServer(
      config(
        { tools: [LookupOrderTool, RefundOrderTool] },
        { authorities: { claimsMapping: { roles: 'roles' }, profiles: { admin: { roles: { any: ['admin'] } } } } },
      ),
    );

    expect(await cacheScopeOf(server, method)).toBe('private');
  });

  it.each(RESULTS)('%s stays public when nothing shapes it per caller', async (method) => {
    const server = await createTestFetchServer(config({}));

    expect(await cacheScopeOf(server, method)).toBe('public');
  });
});

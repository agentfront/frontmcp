import 'reflect-metadata';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Tool, ToolContext, type FrontMcpConfigInput } from '../../common';

/**
 * A rule that checks `relationships` on a server without a `relationshipResolver` can never pass, so the server
 * refuses to start, for a rule on an entry and in a profile alike.
 */

const isOwner = { relationships: { type: 'owner', resource: 'ticket', resourceId: { fromInput: 'id' } } };
const resolver = { check: async () => true };

function serverWith(rule: unknown, authorities: Record<string, unknown> = {}): FrontMcpConfigInput {
  @Tool({ name: 'close_ticket', inputSchema: {}, authorities: rule as 'admin' })
  class CloseTicketTool extends ToolContext {
    async execute() {
      return { closed: true };
    }
  }
  @App({ id: 'desk', name: 'Desk', tools: [CloseTicketTool] })
  class DeskApp {}
  return {
    info: { name: 'authorities-relationship-resolver', version: '1.0.0' },
    apps: [DeskApp],
    authorities: { claimsMapping: { roles: 'roles' }, ...authorities },
  };
}

describe('startup check for relationship rules', () => {
  it.each([
    ['a relationship rule', isOwner],
    ['a relationship rule under not', { not: isOwner }],
    ['a relationship rule inside anyOf', { anyOf: [{ roles: { any: ['admin'] } }, isOwner] }],
  ])('refuses to start with %s and no relationshipResolver', async (_label, rule) => {
    const startup = createTestFetchServer(serverWith(rule));

    await expect(startup).rejects.toThrow(/Relationship resolver required: Tool "close_ticket"/);
    await expect(startup).rejects.toThrow(/no relationshipResolver is configured/);
  });

  it('refuses to start with a profile that checks relationships and no relationshipResolver', async () => {
    const startup = createTestFetchServer(serverWith('owner', { profiles: { owner: isOwner } }));

    await expect(startup).rejects.toThrow(/Relationship resolver required: profile "owner"/);
  });

  it('starts with a relationship rule when a relationshipResolver is configured', async () => {
    const server = await createTestFetchServer(serverWith({ not: isOwner }, { relationshipResolver: resolver }));

    expect(server.handler).toBeInstanceOf(Function);
  });

  it('starts without a relationshipResolver when no rule checks relationships', async () => {
    const server = await createTestFetchServer(serverWith({ roles: { any: ['admin'] } }));

    expect(server.handler).toBeInstanceOf(Function);
  });
});

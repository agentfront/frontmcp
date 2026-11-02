import 'reflect-metadata';

import { App, FrontMcp, Tool, ToolContext, z } from '@frontmcp/sdk';

const searchHit = z.union([
  z.object({ kind: z.literal('document'), title: z.string() }),
  z.object({ kind: z.literal('person'), name: z.string() }),
]);

@Tool({ name: 'search', inputSchema: { query: z.string() }, outputSchema: searchHit })
export class SearchTool extends ToolContext {
  async execute(input: { query: string }) {
    return { kind: 'document' as const, title: input.query };
  }
}

const principal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string() }),
  z.object({ kind: z.literal('group'), members: z.array(z.string()) }),
]);

@Tool({
  name: 'resolve_principal',
  inputSchema: {},
  outputSchema: principal,
  output: { undeclaredKeys: 'fail' },
})
export class ResolvePrincipalTool extends ToolContext {
  async execute() {
    return { kind: 'group' as const, members: ['u_1'] };
  }
}

@App({ name: 'Directory', tools: [SearchTool, ResolvePrincipalTool], output: { undeclaredKeys: 'warn' } })
export class DirectoryApp {}

@FrontMcp({ info: { name: 'directory', version: '1.0.0' }, apps: [DirectoryApp], output: { undeclaredKeys: 'keep' } })
export class DirectoryServer {}

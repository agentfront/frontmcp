/**
 * `plugins: [CodeCallPlugin]`, the class without `init()`, works with the default options (#803).
 *
 * #793 moved the CodeCall meta-tools to `static dynamicTools(options)`, which the plugin registry
 * collected only for `init()` and factory records. The class form got no tools, while the plugin's
 * list hook still hid the app's own tools, so `tools/list` was empty and every call failed. Before
 * that, the class form listed the meta-tools without the `CodeCallConfig` provider they need.
 */
import 'reflect-metadata';

import { App, FrontMcpInstance, LogLevel, Tool, ToolContext, z, type DirectMcpServer } from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';

const CODECALL_TOOLS = [
  'codecall:describe',
  'codecall:execute',
  'codecall:invoke',
  'codecall:search',
  'codecall:searchKnowledge',
  'codecall:searchSkills',
];

@Tool({
  name: 'search_tickets',
  description: 'Search support tickets',
  inputSchema: { status: z.string().optional() },
})
class SearchTickets extends ToolContext {
  async execute() {
    return { tickets: [] as string[] };
  }
}

@App({ id: 'help-desk', name: 'Help Desk', tools: [SearchTickets], plugins: [CodeCallPlugin] })
class HelpDeskClassForm {}

@App({ id: 'help-desk', name: 'Help Desk', tools: [SearchTickets], plugins: [CodeCallPlugin.init()] })
class HelpDeskInitForm {}

async function serve(app: typeof HelpDeskClassForm): Promise<DirectMcpServer> {
  return FrontMcpInstance.createDirect({
    info: { name: 'help-desk', version: '1.0.0' },
    apps: [app],
    logging: { level: LogLevel.Off },
  });
}

async function listedToolNames(server: DirectMcpServer): Promise<string[]> {
  return (await server.listTools()).tools.map((tool) => tool.name).sort();
}

describe('plugins: [CodeCallPlugin] without init() (#803)', () => {
  const servers: DirectMcpServer[] = [];

  afterAll(async () => {
    await Promise.all(servers.map((server) => server.dispose()));
  });

  async function open(app: typeof HelpDeskClassForm): Promise<DirectMcpServer> {
    const server = await serve(app);
    servers.push(server);
    return server;
  }

  it('lists the CodeCall meta-tools, as CodeCallPlugin.init() does', async () => {
    const classForm = await open(HelpDeskClassForm);
    const initForm = await open(HelpDeskInitForm);

    expect(await listedToolNames(classForm)).toEqual(CODECALL_TOOLS);
    expect(await listedToolNames(classForm)).toEqual(await listedToolNames(initForm));
  });

  it("reaches the app's own tool through CodeCall with the default options", async () => {
    const server = await open(HelpDeskClassForm);

    const invoked = await server.callTool('codecall:invoke', { tool: 'search_tickets', input: {} });
    expect(invoked.isError).toBeFalsy();
    expect(JSON.stringify(invoked)).toContain('"tickets":[]');

    const described = await server.callTool('codecall:describe', { toolNames: ['search_tickets'] });
    expect(described.isError).toBeFalsy();
    expect(described.structuredContent).toEqual(
      expect.objectContaining({ tools: [expect.objectContaining({ name: 'search_tickets' })] }),
    );
  });

  it('searches the same catalog as init() does', async () => {
    const classForm = await open(HelpDeskClassForm);
    const initForm = await open(HelpDeskInitForm);

    const search = async (server: DirectMcpServer) =>
      (await server.callTool('codecall:search', { queries: ['search support tickets'] })).structuredContent;

    expect(await search(classForm)).toEqual(await search(initForm));
    expect(await search(classForm)).toEqual(expect.objectContaining({ totalAvailableTools: 1 }));
  });

  it('answers a direct call of the hidden app tool as init() does (codecall_only)', async () => {
    const classForm = await open(HelpDeskClassForm);
    const initForm = await open(HelpDeskInitForm);

    const outcome = async (server: DirectMcpServer) =>
      server.callTool('search_tickets', {}).then(
        (result) => ({ isError: !!result.isError }),
        (error: Error) => ({ rejected: error.message }),
      );

    const classOutcome = await outcome(classForm);
    // Refused in both forms: never an ordinary successful result.
    expect(classOutcome).not.toEqual({ isError: false });
    expect(classOutcome).toEqual(await outcome(initForm));
  });
});

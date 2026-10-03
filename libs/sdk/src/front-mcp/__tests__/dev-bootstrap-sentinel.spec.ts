/**
 * The `frontmcp dev --stdio` ready sentinel reports where the server listens (#679).
 *
 * The bridge exports `PORT` and `FRONTMCP_HTTP_ENTRY_PATH`, but
 * `@FrontMcp({ http: { port, entryPath } })` can hard-code either — the bridge
 * then talked to a port or path nobody served. The sentinel line now carries the
 * port and MCP path this server actually uses.
 */
import 'reflect-metadata';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpServerInstance } from '../../server/server.instance';
import { FrontMcpInstance } from '../front-mcp';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'demo', name: 'Demo', tools: [PingTool] })
class DemoApp {}

async function sentinelLines(http?: Record<string, unknown>): Promise<string[]> {
  const config = frontMcpMetadataSchema.parse({
    info: { name: 'sentinel', version: '1.0.0' },
    apps: [DemoApp],
    logging: { level: LogLevel.Off },
    ...(http ? { http } : {}),
  });
  const instance = new FrontMcpInstance(config);
  await instance.ready;
  const start = jest.spyOn(FrontMcpServerInstance.prototype, 'start').mockResolvedValue(undefined);
  const write = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await instance.start();
    return write.mock.calls.map(([chunk]) => String(chunk)).filter((line) => line.includes('__FRONTMCP_'));
  } finally {
    write.mockRestore();
    start.mockRestore();
  }
}

describe('dev bridge bootstrap sentinel', () => {
  const saved = process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'];

  afterEach(() => {
    if (saved === undefined) delete process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'];
    else process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] = saved;
  });

  it('reports a hard-coded port and entry path', async () => {
    process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] = '1';
    const lines = await sentinelLines({ port: 45678, entryPath: '/decorated/' });
    expect(lines).toEqual(['__FRONTMCP_BOOTSTRAP_COMPLETE__ {"port":45678,"path":"/decorated"}\n']);
  });

  it('reports the root path when no entry path is configured', async () => {
    process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'] = '1';
    const [line] = await sentinelLines({ port: 45679 });
    expect(JSON.parse(line.replace('__FRONTMCP_BOOTSTRAP_COMPLETE__', ''))).toEqual({ port: 45679, path: '/' });
  });

  it('stays silent outside the dev bridge', async () => {
    delete process.env['FRONTMCP_DEV_BOOTSTRAP_SENTINEL'];
    expect(await sentinelLines({ port: 45680 })).toEqual([]);
  });
});

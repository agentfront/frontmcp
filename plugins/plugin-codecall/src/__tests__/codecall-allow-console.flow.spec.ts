/**
 * `vm.allowConsole: true`: a script's `console` calls reach the server's logger (logger `CodeCall:script`). Only an
 * explicit `true` turns it on; without it, or with a preset alone, a script that uses `console` is refused before it
 * runs.
 */
import 'reflect-metadata';

import {
  App,
  FrontMcpInstance,
  LogLevel,
  LogTransport,
  LogTransportInterface,
  Tool,
  ToolContext,
  type DirectMcpServer,
  type LogRecord,
} from '@frontmcp/sdk';

import CodeCallPlugin from '../codecall.plugin';
import type { CodeCallPluginOptionsInput } from '../codecall.types';

const records: LogRecord[] = [];
let failTransport = false;

@LogTransport({ name: 'ScriptConsoleCapture', description: 'Keeps log records for assertions' })
class LogCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (failTransport && record.prefix.includes('CodeCall:script')) throw new Error('transport down');
    records.push(record);
  }
}

@Tool({ name: 'notes.list', description: 'Lists notes', inputSchema: {} })
class ListNotesTool extends ToolContext {
  async execute() {
    return { notes: [] };
  }
}

const servers: DirectMcpServer[] = [];

async function startServer(options: CodeCallPluginOptionsInput): Promise<DirectMcpServer> {
  @App({ id: 'notes', name: 'Notes', tools: [ListNotesTool], plugins: [CodeCallPlugin.init(options)] })
  class NotesApp {}

  const server = await FrontMcpInstance.createDirect({
    info: { name: 'codecall-allow-console', version: '1.0.0' },
    apps: [NotesApp],
    logging: { level: LogLevel.Debug, enableConsole: false, transports: [LogCapture] },
  });
  servers.push(server);
  return server;
}

async function runScript(
  server: DirectMcpServer,
  script: string,
): Promise<{ status: string; result?: unknown; error?: unknown }> {
  const result = (await server.callTool('codecall:execute', { script })) as { structuredContent?: unknown };
  return result.structuredContent as { status: string; result?: unknown; error?: unknown };
}

function scriptLines(): Array<[string, string]> {
  return records
    .filter((record) => record.prefix.includes('CodeCall:script'))
    .map((record) => [record.levelName, record.message]);
}

beforeEach(() => {
  records.length = 0;
  failTransport = false;
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.dispose()));
});

describe('vm.allowConsole: true', () => {
  it("sends each console method's lines to the server's logger", async () => {
    const server = await startServer({ mode: 'codecall_only', vm: { allowConsole: true } });

    const outcome = await runScript(
      server,
      `console.log('log', { a: 1 });
       console.info('info');
       console.warn('warn');
       console.error('error', 2);
       console.debug('debug');
       return 'done';`,
    );

    expect(outcome).toMatchObject({ status: 'ok', result: 'done' });
    expect(scriptLines()).toEqual([
      ['info', 'log {"a":1}'],
      ['info', 'info'],
      ['warn', 'warn'],
      ['error', 'error 2'],
      ['debug', 'debug'],
    ]);
  });

  it('describes console in codecall:execute', async () => {
    const server = await startServer({ mode: 'codecall_only', vm: { allowConsole: true } });

    const tools = await server.listTools();
    const execute = tools.tools.find((tool) => tool.name === 'codecall:execute');

    expect(execute?.description).toContain('LOGGING: console.log/info/warn/error/debug');
    expect(execute?.description).not.toContain('console (use mcpLog)');
  });

  it("enforces the sandbox's console call limit and the server's lines per second", async () => {
    const server = await startServer({ mode: 'codecall_only', vm: { allowConsole: true, allowLoops: true } });

    const outcome = await runScript(
      server,
      `for (let i = 0; i < 1001; i++) { console.log('line ' + i); }\nreturn 'all';`,
    );

    expect(outcome.status).toBe('runtime_error');
    expect(JSON.stringify(outcome.error)).toContain('Console call limit exceeded (max: 1000)');
    expect(scriptLines().filter(([level]) => level === 'info')).toHaveLength(50);
    expect(scriptLines().filter(([level]) => level === 'warn')).toEqual([
      ['warn', 'Dropping script console output: more than 50 lines a second'],
    ]);
  });

  it('keeps a logger failure from the script', async () => {
    const server = await startServer({ mode: 'codecall_only', vm: { allowConsole: true } });
    const reported = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    failTransport = true;

    const outcome = await runScript(server, `console.log('lost');\nreturn 'still ran';`);

    expect(outcome).toMatchObject({ status: 'ok', result: 'still ran' });
    reported.mockRestore();
  });
});

describe.each<[string, CodeCallPluginOptionsInput]>([
  ['vm.allowConsole: false', { mode: 'codecall_only', vm: { allowConsole: false } }],
  ['no vm.allowConsole', { mode: 'codecall_only' }],
  ["the 'secure' preset alone", { mode: 'codecall_only', vm: { preset: 'secure' } }],
  ["the 'balanced' preset alone", { mode: 'codecall_only', vm: { preset: 'balanced' } }],
  ["the 'experimental' preset alone", { mode: 'codecall_only', vm: { preset: 'experimental' } }],
])('%s', (_, options) => {
  it('refuses a script that uses console before it runs, and logs nothing from it', async () => {
    const server = await startServer(options);

    const outcome = await runScript(server, `console.log('hi');\nreturn 1;`);

    expect(outcome.status).toBe('illegal_access');
    expect(JSON.stringify(outcome.error)).toContain('unless vm.allowConsole is true; use mcpLog');
    expect(scriptLines()).toEqual([]);
  });
});

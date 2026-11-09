/**
 * `vm.allowConsole` has had no effect since 1.9.2: scripts never get `console`. Its `@deprecated` note was the only
 * sign, so a server that set it now says so in its log when it starts.
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

const warnings: string[] = [];

@LogTransport({ name: 'CodeCallWarnings', description: 'Keeps warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Tool({ name: 'notes.list', description: 'Lists notes', inputSchema: {} })
class ListNotesTool extends ToolContext {
  async execute() {
    return { notes: [] };
  }
}

const servers: DirectMcpServer[] = [];

async function startServer(options: CodeCallPluginOptionsInput): Promise<void> {
  @App({ id: 'notes', name: 'Notes', tools: [ListNotesTool], plugins: [CodeCallPlugin.init(options)] })
  class NotesApp {}

  servers.push(
    await FrontMcpInstance.createDirect({
      info: { name: 'codecall-allow-console', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
    }),
  );
}

const allowConsoleWarnings = () => warnings.filter((message) => message.includes('vm.allowConsole'));

beforeEach(() => {
  warnings.length = 0;
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.dispose()));
});

describe('vm.allowConsole', () => {
  it.each([true, false])('is reported as ignored when a server starts with allowConsole: %s', async (allowConsole) => {
    await startServer({ vm: { allowConsole } });

    expect(allowConsoleWarnings()).toEqual([
      expect.stringContaining('`vm.allowConsole` has no effect and is ignored: scripts never get `console`'),
    ]);
  });

  it('is not reported when the options leave it out', async () => {
    await startServer({ vm: { preset: 'balanced' } });

    expect(allowConsoleWarnings()).toEqual([]);
  });
});

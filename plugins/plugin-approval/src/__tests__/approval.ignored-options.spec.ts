/**
 * Options ApprovalPlugin accepts and never reads: `enableAudit` and `maxDelegationDepth`. They were documented as
 * reserved; a server that sets one now says so in its log when it starts.
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

import ApprovalPlugin, { type ApprovalPluginOptions } from '../approval.plugin';

const warnings: string[] = [];

@LogTransport({ name: 'ApprovalWarnings', description: 'Keeps warnings for assertions' })
class WarningCapture extends LogTransportInterface {
  log(record: LogRecord): void {
    if (record.level === LogLevel.Warn) warnings.push(record.message);
  }
}

@Tool({ name: 'notes_delete', description: 'Deletes a note', inputSchema: {}, approval: true })
class DeleteNoteTool extends ToolContext {
  async execute() {
    return { deleted: true };
  }
}

const servers: DirectMcpServer[] = [];

async function startServer(options: ApprovalPluginOptions): Promise<void> {
  @App({
    id: 'notes',
    name: 'Notes',
    tools: [DeleteNoteTool],
    plugins: [ApprovalPlugin.init({ storage: { type: 'memory' }, ...options })],
  })
  class NotesApp {}

  servers.push(
    await FrontMcpInstance.createDirect({
      info: { name: 'approval-ignored-options', version: '1.0.0' },
      apps: [NotesApp],
      logging: { level: LogLevel.Warn, enableConsole: false, transports: [WarningCapture] },
    }),
  );
}

const ignoredWarnings = () => warnings.filter((message) => message.startsWith('ApprovalPlugin ignores'));

beforeEach(() => {
  warnings.length = 0;
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.dispose()));
});

describe('ApprovalPlugin options it never reads', () => {
  it('names each one that is set, once, when the server starts', async () => {
    await startServer({ mode: 'webhook', webhook: { challengeTtl: 60 }, enableAudit: true, maxDelegationDepth: 2 });

    expect(ignoredWarnings()).toEqual([
      expect.stringContaining(
        'ApprovalPlugin ignores `enableAudit`, `maxDelegationDepth`: the plugin logs no audit trail and bounds no delegation.',
      ),
    ]);
  });

  it('says nothing for the options it reads', async () => {
    await startServer({
      mode: 'webhook',
      webhook: { challengeTtl: 60 },
      namespace: 'notes',
      cleanupIntervalSeconds: 0,
    });

    expect(ignoredWarnings()).toEqual([]);
  });
});

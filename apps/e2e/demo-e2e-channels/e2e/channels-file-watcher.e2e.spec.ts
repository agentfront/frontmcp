/**
 * E2E: the demo's file-watcher channel declares a folder and watches nothing by itself. A file written to that folder
 * reaches a Claude Code stdio session as a `notifications/claude/channel` line, for the events the channel declares.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import { appendFile, mkdtemp, rm, writeFile } from '@frontmcp/utils';

import { StdioJsonRpcProcess, type JsonRpcMessage } from '../../demo-e2e-stdio-transport/e2e/helpers/stdio-json-rpc';

const projectPath = path.join(__dirname, '..');
const CHANNEL_NOTIFICATION = 'notifications/claude/channel';

const INITIALIZE: JsonRpcMessage = {
  jsonrpc: '2.0',
  id: 0,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: { roots: { listChanged: true } },
    clientInfo: { name: 'claude-code', title: 'Claude Code', version: '2.1.322' },
  },
};

/** The `meta` of a message, when it is a notification of the file-watcher channel. */
function fileWatcherMeta(message: JsonRpcMessage): Record<string, string> | undefined {
  const meta = message.params?.['meta'] as Record<string, string> | undefined;
  return message.method === CHANNEL_NOTIFICATION && meta?.['source'] === 'file-watcher' ? meta : undefined;
}

/** Whether a message tells that `event` happened to the file named `fileName`. */
function tellsAbout(message: JsonRpcMessage, fileName: string, event: string): boolean {
  const meta = fileWatcherMeta(message);
  return meta?.['file'] === fileName && meta['event_type'] === event;
}

describe('File watcher channel in a Claude Code stdio session', () => {
  let server: StdioJsonRpcProcess;
  let watchedFolder: string;

  /** Writes probe files until the channel tells about one: a file written before the watch started is never told. */
  async function waitForWatcher(timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (let attempt = 1; Date.now() < deadline; attempt++) {
      const probe = `ready-${attempt}.probe`;
      await writeFile(path.join(watchedFolder, probe), 'probe');
      const told = await server.waitFor((message) => tellsAbout(message, probe, 'create'), 500).catch(() => undefined);
      if (told) return;
    }
    throw new Error(`The file-watcher channel told about no probe file within ${timeoutMs} ms`);
  }

  beforeAll(async () => {
    watchedFolder = await mkdtemp(path.join(os.tmpdir(), 'demo-e2e-channels-watch-'));
    server = StdioJsonRpcProcess.start(path.join(projectPath, 'src/stdio-entrypoint.ts'), projectPath, {
      CHANNELS_WATCH_DIR: watchedFolder,
    });
    const initialized = await server.request(INITIALIZE, 60_000);
    expect(initialized.result?.['capabilities']).toMatchObject({ experimental: { 'claude/channel': {} } });
    server.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await waitForWatcher();
  }, 120_000);

  afterAll(async () => {
    await server.stop();
    await rm(watchedFolder, { recursive: true, force: true });
  });

  it('tells the session about a file created in the watched folder', async () => {
    await writeFile(path.join(watchedFolder, 'report.csv'), 'id,total\n');

    const notification = await server.waitFor((message) => tellsAbout(message, 'report.csv', 'create'));

    expect(notification).toEqual({
      jsonrpc: '2.0',
      method: CHANNEL_NOTIFICATION,
      params: {
        content: '[create] report.csv',
        meta: { file: 'report.csv', event_type: 'create', source: 'file-watcher' },
      },
    });
  });

  it('tells the session when the file changes', async () => {
    await appendFile(path.join(watchedFolder, 'report.csv'), '1,42\n');

    const notification = await server.waitFor((message) => tellsAbout(message, 'report.csv', 'change'));

    expect(notification.params).toEqual({
      content: '[change] report.csv',
      meta: { file: 'report.csv', event_type: 'change', source: 'file-watcher' },
    });
  });

  it('tells nothing about a removed file, an event the channel does not declare', async () => {
    await rm(path.join(watchedFolder, 'report.csv'));
    // Two later files, told in order: a removal would have been told before the second one
    for (const laterFile of ['later-1.txt', 'later-2.txt']) {
      await writeFile(path.join(watchedFolder, laterFile), 'still watching');
      await server.waitFor((message) => tellsAbout(message, laterFile, 'create'));
    }

    const messages = server.stdoutLines.map((line) => JSON.parse(line) as JsonRpcMessage);
    const toldEvents = messages.flatMap((message) => fileWatcherMeta(message)?.['event_type'] ?? []);

    expect(toldEvents).toContain('create');
    expect(toldEvents).not.toContain('delete');
    for (const message of messages) expect(message).toHaveProperty('jsonrpc', '2.0');
  });
});

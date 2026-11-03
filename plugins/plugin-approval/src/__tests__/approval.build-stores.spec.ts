/**
 * A build boots the server only to read it, and opens none of its stores (#1041): there an ApprovalPlugin `storage` on
 * SQLite opens no file. A server that starts opens it as before.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';
import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import { ApprovalPlugin } from '../index';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'approval-build-stores-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function serverWith(path: string) {
  @App({
    id: 'approving',
    name: 'Approving',
    plugins: [ApprovalPlugin.init({ mode: 'webhook', storage: { type: 'sqlite', sqlite: { path } } })],
  })
  class ApprovingApp {}

  return {
    info: { name: 'approval-build-stores', version: '1.0.0' },
    apps: [ApprovingApp],
    logging: { level: LogLevel.Off },
    tasks: { store: false },
  };
}

it("opens no store in a build's boot", async () => {
  const path = join(dir, 'approvals.sqlite');
  const instance = await FrontMcpInstance.createForManifest(serverWith(path));
  await instance.shutdown();

  expect(await fileExists(path)).toBe(false);
});

it('opens its store when the server starts', async () => {
  const path = join(dir, 'approvals.sqlite');
  const server = await FrontMcpInstance.createDirect(serverWith(path));
  await server.dispose();

  expect(await fileExists(path)).toBe(true);
});

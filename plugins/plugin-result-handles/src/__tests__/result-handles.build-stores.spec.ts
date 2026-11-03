/**
 * A build boots the server only to read it, and opens none of its stores (#1041): there a ResultHandlesPlugin `storage`
 * on SQLite opens no file. A server that starts opens it as before.
 */
import 'reflect-metadata';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { App, FrontMcpInstance, LogLevel } from '@frontmcp/sdk';
import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import { ResultHandlesPlugin } from '../index';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'result-handles-build-stores-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function serverWith(path: string) {
  @App({
    id: 'folding',
    name: 'Folding',
    plugins: [ResultHandlesPlugin.init({ storage: { type: 'sqlite', sqlite: { path } } })],
  })
  class FoldingApp {}

  return {
    info: { name: 'result-handles-build-stores', version: '1.0.0' },
    apps: [FoldingApp],
    logging: { level: LogLevel.Off },
    tasks: { store: false },
  };
}

it("opens no store in a build's boot", async () => {
  const path = join(dir, 'results.sqlite');
  const instance = await FrontMcpInstance.createForManifest(serverWith(path));
  await instance.shutdown();

  expect(await fileExists(path)).toBe(false);
});

it('opens its store when the server starts', async () => {
  const path = join(dir, 'results.sqlite');
  const server = await FrontMcpInstance.createDirect(serverWith(path));
  await server.dispose();

  expect(await fileExists(path)).toBe(true);
});

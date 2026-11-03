/**
 * The CLI host validates a config object with the server's schemas, as the decorator validates a `@FrontMcp` class,
 * before it opens a store: an invalid `transport.persistence` stopped neither, and the CLI opened it.
 */
import 'reflect-metadata';

import * as os from 'os';
import * as path from 'path';

import { fileExists, mkdtemp, rm } from '@frontmcp/utils';

import { App, LogLevel, type FrontMcpConfigInput } from '../../common';
import { connect } from '../../direct/connect';

@App({ id: 'empty', name: 'Empty' })
class EmptyApp {}

const unset = process.env['CLI_CONFIG_VALIDATION_UNSET_VAR'] as string;

const configOf = (options: Record<string, unknown>) =>
  ({
    info: { name: 'cli-config-validation', version: '1.0.0' },
    apps: [EmptyApp],
    logging: { level: LogLevel.Off },
    ...options,
  }) as FrontMcpConfigInput;

describe('the CLI host of a config object', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'frontmcp-cli-config-validation-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('refuses an invalid transport.persistence with the server message, and opens no store', async () => {
    const sessions = path.join(dir, 'sessions.sqlite');
    const config = configOf({
      transport: { persistence: { sqlite: { path: sessions, encryption: { secret: unset } } } },
    });

    await expect(connect(config, { mode: 'cli' })).rejects.toThrow(
      expect.objectContaining({
        name: 'ZodError',
        issues: [expect.objectContaining({ path: ['transport', 'persistence'] })],
      }),
    );
    expect(await fileExists(sessions)).toBe(false);
  });

  it('serves a config whose transport and other options are valid', async () => {
    const config = configOf({
      transport: { persistence: { sqlite: { path: path.join(dir, 'sessions.sqlite') } } },
      fetch: { forwardCallerTokenTo: ['https://api.example.com'] },
      observability: false,
    });

    const client = await connect(config, { mode: 'cli' });
    await client.close();
  });
});

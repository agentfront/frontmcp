/**
 * A server booted to read a config (`mode: 'manifest'`, as `frontmcp build` does) or for the CLI
 * is never handed to a client that connects to serve the same config object.
 */
import 'reflect-metadata';

import type { FrontMcpConfigInput } from '../../common';

const booted = { manifest: { mode: 'manifest' }, cli: { mode: 'cli' }, full: { mode: 'full' } };

jest.mock('../../front-mcp/front-mcp', () => ({
  FrontMcpInstance: {
    createForManifest: jest.fn(async () => booted.manifest),
    createForCli: jest.fn(async () => booted.cli),
    createForConnect: jest.fn(async () => booted.full),
  },
}));

describe('joinInstance', () => {
  it('boots a full server for a config a manifest or CLI server was booted for', async () => {
    const { joinInstance, clearScopeCache } = await import('../connect');
    clearScopeCache();
    const config = { info: { name: 'shared-config', version: '1.0.0' }, apps: [] } as FrontMcpConfigInput;

    const manifest = joinInstance(config, 'manifest');
    const cli = joinInstance(config, 'cli');
    const full = joinInstance(config);

    await expect(manifest.instancePromise).resolves.toBe(booted.manifest);
    await expect(cli.instancePromise).resolves.toBe(booted.cli);
    await expect(full.instancePromise).resolves.toBe(booted.full);
  });

  it('shares one server between the clients of the same config and mode', async () => {
    const { joinInstance, clearScopeCache } = await import('../connect');
    clearScopeCache();
    const config = { info: { name: 'one-config', version: '1.0.0' }, apps: [] } as FrontMcpConfigInput;

    expect(joinInstance(config).instancePromise).toBe(joinInstance(config, 'full').instancePromise);
  });
});

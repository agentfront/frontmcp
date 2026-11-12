/**
 * A new version of an `App.esm()` package is checked as startup checks every app. Its entries that declare
 * `authorities` on a server with no authorities engine to check them were served all the same, as the check of a
 * late app read only the metadata plugins enforce. Such a version is now refused, and the loaded one kept.
 */
import 'reflect-metadata';

import { App, Skill, Tool, ToolContext } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { VersionPoller } from '../../esm-loader/version-poller';
import { VersionResolver } from '../../esm-loader/version-resolver';
import type { Scope } from '../../scope/scope.instance';

// `authorities` is declared by the type augmentation of @frontmcp/auth, which these tests do not load.
const ADMIN_ONLY: Record<string, unknown> = { authorities: { roles: { any: ['admin'] } } };

@Tool({ name: 'wipe', inputSchema: {}, ...ADMIN_ONLY })
class WipeTool extends ToolContext {
  async execute() {
    return { wiped: true };
  }
}

@Skill({ name: 'payroll', description: 'Run payroll', instructions: 'Pay everyone.', ...ADMIN_ONLY })
class PayrollSkill {}

const echoTool = { name: 'echo', execute: async (input: Record<string, unknown>) => JSON.stringify(input) };

function loaded(manifest: Partial<FrontMcpPackageManifest>, version = '1.0.0'): EsmLoadResult {
  return {
    manifest: { name: '@acme/tools', version, ...manifest },
    resolvedVersion: version,
    source: 'network',
    loadedAt: Date.now(),
    rawModule: {},
  };
}

const scopeOf = (server: DirectMcpServer) => (server as unknown as { scope: Scope }).scope;

describe('App.esm() new versions with authorities and no engine to check them', () => {
  let server: DirectMcpServer | undefined;
  let poller: { poll(): Promise<void> } | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    load = jest.spyOn(EsmModuleLoader.prototype, 'load');
    jest.spyOn(VersionPoller.prototype, 'start').mockImplementation(function (this: VersionPoller) {
      poller = this as unknown as { poll(): Promise<void> };
    });
    jest
      .spyOn(VersionResolver.prototype, 'resolve')
      .mockResolvedValue({ resolvedVersion: '1.1.0', availableVersions: ['1.0.0', '1.1.0'] });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
    poller = undefined;
  });

  async function startPolling(first: EsmLoadResult): Promise<{ srv: DirectMcpServer; poll: () => Promise<void> }> {
    load.mockResolvedValueOnce(first);
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', autoUpdate: { enabled: true } })],
    });
    const started = poller;
    if (!started) throw new Error('the version poller did not start');
    return { srv: server, poll: () => started.poll() };
  }

  const toolNames = (srv: DirectMcpServer) =>
    scopeOf(srv)
      .tools.getTools(true)
      .map((tool) => tool.name);

  it('keeps the loaded version when the new one brings a tool with authorities', async () => {
    const { srv, poll } = await startPolling(loaded({ tools: [echoTool] }));
    load.mockResolvedValueOnce(loaded({ tools: [echoTool, WipeTool] }, '1.1.0'));

    await poll();

    expect(toolNames(srv)).toContain('acme:echo');
    expect(toolNames(srv)).not.toContain('acme:wipe');
  });

  it('keeps the loaded version when the new one brings a skill with authorities', async () => {
    const { srv, poll } = await startPolling(loaded({ tools: [echoTool] }));
    load.mockResolvedValueOnce(loaded({ tools: [echoTool], skills: [PayrollSkill] }, '1.1.0'));

    await poll();

    expect(scopeOf(srv).skills.findByName('payroll')).toBeUndefined();
    expect(toolNames(srv)).toContain('acme:echo');
  });
});

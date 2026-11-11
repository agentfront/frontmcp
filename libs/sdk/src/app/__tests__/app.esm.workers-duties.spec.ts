/**
 * The `@Worker` and `@Duty` providers of an `App.esm()` package across versions, through a real scope with the package
 * load mocked at the `EsmModuleLoader` boundary: a replace hands their work to the new version, and a new version that
 * fails to start gives it back.
 */
import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  App,
  Duty,
  Provider,
  Tool,
  ToolContext,
  Worker,
  type OnShutdown,
  type ProviderType,
  type WorkerRunContext,
} from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { VersionPoller } from '../../esm-loader/version-poller';
import { VersionResolver } from '../../esm-loader/version-resolver';

interface Run {
  who: string;
  signal: AbortSignal;
  /** The runs of the same worker that were still running when this one started. */
  alongside: string[];
}

const runs: Run[] = [];
const dutyRuns: string[] = [];
const shutdowns: string[] = [];

function liveRuns(worker: string): string[] {
  return runs.filter((run) => run.who.startsWith(`${worker} `) && !run.signal.aborted).map((run) => run.who);
}

function runsOf(worker: string): Array<{ who: string; aborted: boolean; alongside: string[] }> {
  return runs
    .filter((run) => run.who.startsWith(`${worker} `))
    .map(({ who, signal, alongside }) => ({ who, aborted: signal.aborted, alongside }));
}

function untilAborted(worker: string, version: string, { signal }: WorkerRunContext): Promise<void> {
  runs.push({ who: `${worker} ${version}`, signal, alongside: liveRuns(worker) });
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve()));
}

function versionOf(version: string, extraProviders: ProviderType[] = []): EsmLoadResult {
  @Worker({ name: 'ticker', scope: 'process' })
  class ProcessWorker implements OnShutdown {
    run(context: WorkerRunContext): Promise<void> {
      return untilAborted('process', version, context);
    }
    onShutdown(): void {
      shutdowns.push(`process ${version}`);
    }
  }
  @Worker({ name: 'inbox', scope: 'machine', leaseMs: 1_000 })
  class LeasedWorker implements OnShutdown {
    run(context: WorkerRunContext): Promise<void> {
      return untilAborted('leased', version, context);
    }
    onShutdown(): void {
      shutdowns.push(`leased ${version}`);
    }
  }
  @Duty({ name: 'sweep', scope: 'machine', every: 50, leaseMs: 1_000 })
  class SweepDuty implements OnShutdown {
    run(): void {
      dutyRuns.push(version);
    }
    onShutdown(): void {
      shutdowns.push(`duty ${version}`);
    }
  }
  @Tool({ name: 'version', inputSchema: {} })
  class VersionTool extends ToolContext {
    async execute() {
      return version;
    }
  }
  return {
    manifest: {
      name: '@acme/tools',
      version,
      providers: [ProcessWorker, LeasedWorker, SweepDuty, ...extraProviders],
      tools: [VersionTool],
    },
    resolvedVersion: version,
    source: 'network',
    loadedAt: Date.now(),
    rawModule: {},
  };
}

const textOf = (result: { content: unknown; structuredContent?: unknown }) =>
  (result.structuredContent as { value?: string } | undefined)?.value ??
  (result.content as Array<{ text: string }>)[0]?.text;

async function until(condition: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('App.esm() workers and duties across versions', () => {
  let server: DirectMcpServer | undefined;
  let poller: { poll(): Promise<void> } | undefined;
  let load: jest.SpyInstance;
  let home: string;
  let previousHome: string | undefined;

  beforeEach(() => {
    runs.length = 0;
    dutyRuns.length = 0;
    shutdowns.length = 0;
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-esm-background-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    load = jest.spyOn(EsmModuleLoader.prototype, 'load').mockResolvedValueOnce(versionOf('1.0.0'));
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
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  /** Serve the package's 1.0.0 with auto-update on, once its workers run and its duty ran. */
  async function startPolling(): Promise<{ srv: DirectMcpServer; poll: () => Promise<void> }> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', autoUpdate: { enabled: true } })],
    });
    const started = poller;
    if (!started) throw new Error('the version poller did not start');
    await until(() => liveRuns('process').length === 1 && liveRuns('leased').length === 1 && dutyRuns.length > 0);
    return { srv: server, poll: () => started.poll() };
  }

  it("stops the replaced version's process worker before the new version's starts, so it never runs twice", async () => {
    const { poll } = await startPolling();
    load.mockResolvedValueOnce(versionOf('1.1.0'));

    await poll();
    await until(() => liveRuns('process').includes('process 1.1.0'));

    expect(runsOf('process')).toEqual([
      { who: 'process 1.0.0', aborted: true, alongside: [] },
      { who: 'process 1.1.0', aborted: false, alongside: [] },
    ]);
  });

  it('hands the leased worker and the duty over to the new version, without a name conflict', async () => {
    const { srv, poll } = await startPolling();
    load.mockResolvedValueOnce(versionOf('1.1.0'));

    await poll();
    const dutyRunsAtReplace = dutyRuns.length;
    await until(
      () => liveRuns('leased').includes('leased 1.1.0') && dutyRuns.slice(dutyRunsAtReplace).includes('1.1.0'),
    );

    expect(textOf(await srv.callTool('acme:version', {}))).toBe('1.1.0');
    expect(runsOf('leased')).toEqual([
      { who: 'leased 1.0.0', aborted: true, alongside: [] },
      { who: 'leased 1.1.0', aborted: false, alongside: [] },
    ]);
    expect(new Set(dutyRuns.slice(dutyRunsAtReplace))).toEqual(new Set(['1.1.0']));
  });

  it("runs each provider's onShutdown() once, at the server's shutdown, though a replace stopped its work", async () => {
    const { poll } = await startPolling();
    load.mockResolvedValueOnce(versionOf('1.1.0'));

    await poll();

    expect(runs.filter((run) => run.who.endsWith(' 1.0.0')).every((run) => run.signal.aborted)).toBe(true);
    expect(shutdowns).toEqual([]);

    await server?.dispose();
    server = undefined;

    expect([...shutdowns].sort()).toEqual([
      'duty 1.0.0',
      'duty 1.1.0',
      'leased 1.0.0',
      'leased 1.1.0',
      'process 1.0.0',
      'process 1.1.0',
    ]);
  });

  describe('when the new version fails to start', () => {
    @Provider({ name: 'FailingOnReady' })
    class FailingOnReady {
      onReady(): void {
        throw new Error('no database');
      }
    }
    @Worker({ name: 'inbox', scope: 'machine' })
    class SecondInbox {
      run(context: WorkerRunContext): Promise<void> {
        return untilAborted('second-inbox', '1.1.0', context);
      }
    }

    it.each([
      ['a provider of it fails in onReady()', FailingOnReady],
      ['one of its workers cannot start', SecondInbox],
    ])('keeps the served version, whose workers and duty run again: %s', async (_case, failing) => {
      const { srv, poll } = await startPolling();
      load.mockResolvedValueOnce(versionOf('1.1.0', [failing]));

      await poll();
      const dutyRunsAtRollback = dutyRuns.length;
      await until(
        () =>
          liveRuns('process').includes('process 1.0.0') &&
          liveRuns('leased').includes('leased 1.0.0') &&
          dutyRuns.slice(dutyRunsAtRollback).includes('1.0.0'),
      );

      expect(textOf(await srv.callTool('acme:version', {}))).toBe('1.0.0');
      expect(runsOf('process')).toEqual([
        { who: 'process 1.0.0', aborted: true, alongside: [] },
        { who: 'process 1.1.0', aborted: true, alongside: [] },
        { who: 'process 1.0.0', aborted: false, alongside: [] },
      ]);
      expect(liveRuns('leased')).toEqual(['leased 1.0.0']);
      expect(runs.filter((run) => run.who.endsWith(' 1.1.0')).every((run) => run.signal.aborted)).toBe(true);
      expect(new Set(dutyRuns.slice(dutyRunsAtRollback))).toEqual(new Set(['1.0.0']));
      expect([...shutdowns].sort()).toEqual(['duty 1.1.0', 'leased 1.1.0', 'process 1.1.0']);

      await server?.dispose();
      server = undefined;
      expect([...shutdowns].sort()).toEqual([
        'duty 1.0.0',
        'duty 1.1.0',
        'leased 1.0.0',
        'leased 1.1.0',
        'process 1.0.0',
        'process 1.1.0',
      ]);
    });
  });
});

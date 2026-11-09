/**
 * The jobs and workflows of an `App.esm()` package, through a real scope with the package load mocked at the
 * `EsmModuleLoader` boundary: they join the server's job system as a local app's do, and a new version replaces them.
 */
import 'reflect-metadata';

import { z } from '@frontmcp/lazy-zod';

import { App, Job, JobContext, Workflow, type EsmAppOptions } from '../../common';
import type { DirectMcpServer } from '../../direct/direct.types';
import { normalizeEsmExport, type FrontMcpPackageManifest } from '../../esm-loader/esm-manifest';
import { EsmModuleLoader, type EsmLoadResult } from '../../esm-loader/esm-module-loader';
import { VersionPoller } from '../../esm-loader/version-poller';
import { VersionResolver } from '../../esm-loader/version-resolver';
import ExecuteJobFlow from '../../job/flows/execute-job.flow';
import type { Scope } from '../../scope/scope.instance';

const GREETING = Symbol('GREETING');

function reportJob(name: string, answer: (job: JobContext) => Promise<string> | string) {
  @Job({ name, inputSchema: {}, outputSchema: { report: z.string() } })
  class ReportJob extends JobContext {
    async execute() {
      return { report: await answer(this) };
    }
  }
  return ReportJob;
}

function reportFlow(name: string, jobName: string) {
  @Workflow({ name, steps: [{ id: 'report', jobName }] })
  class ReportFlow {}
  return ReportFlow;
}

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
const jobNames = (server: DirectMcpServer) =>
  scopeOf(server)
    .jobs?.getJobs(true)
    .map((job) => job.name) ?? [];
const reportOf = async (server: DirectMcpServer, jobName: string) =>
  ((await server.executeJob(jobName, {})).structuredContent as { result?: { report?: string } }).result?.report;

describe('App.esm() jobs and workflows', () => {
  let server: DirectMcpServer | undefined;
  let load: jest.SpyInstance;

  beforeEach(() => {
    load = jest.spyOn(EsmModuleLoader.prototype, 'load');
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await server?.dispose().catch(() => undefined);
    server = undefined;
  });

  async function createGateway(options: EsmAppOptions = {}, jobs?: { enabled: boolean }): Promise<DirectMcpServer> {
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', ...options })],
      ...(jobs ? { jobs } : {}),
    });
    return server;
  }

  it('turns the job system on, and runs a package job that resolves the package providers', async () => {
    load.mockResolvedValue(
      loaded({
        providers: [{ provide: GREETING, useValue: 'hello' }],
        jobs: [reportJob('daily-report', (job) => `${job.get<string>(GREETING)} from the job`)],
      }),
    );
    const srv = await createGateway();

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toContain('execute_job');
    expect(await reportOf(srv, 'daily-report')).toBe('hello from the job');
  });

  it('runs a package workflow over the package jobs', async () => {
    load.mockResolvedValue(
      loaded({
        jobs: [reportJob('daily-report', () => 'reported')],
        workflows: [reportFlow('daily', 'daily-report')],
      }),
    );
    const srv = await createGateway();

    const run = await srv.executeWorkflow('daily', {});

    expect(run.structuredContent).toMatchObject({ state: 'completed' });
  });

  it('serves no job when the server sets jobs.enabled: false', async () => {
    load.mockResolvedValue(loaded({ jobs: [reportJob('daily-report', () => 'reported')] }));
    const srv = await createGateway({}, { enabled: false });

    expect(scopeOf(srv).jobs).toBeUndefined();
    expect((await srv.listTools()).tools.map((tool) => tool.name)).not.toContain('execute_job');
  });

  it('lets the filter through by the job and workflow names', async () => {
    load.mockResolvedValue(
      loaded({
        jobs: [reportJob('daily-report', () => 'reported'), reportJob('purge-data', () => 'purged')],
        workflows: [reportFlow('daily', 'daily-report'), reportFlow('purge', 'purge-data')],
      }),
    );
    const srv = await createGateway({ filter: { exclude: { jobs: ['purge-*'], workflows: ['purge'] } } });

    expect(jobNames(srv)).toEqual(['daily-report']);
    expect(
      scopeOf(srv)
        .workflows?.getWorkflows(true)
        .map((workflow) => workflow.name),
    ).toEqual(['daily']);
  });

  it('runs the jobs of a default-exported @App class', async () => {
    @App({ name: 'reports', jobs: [reportJob('daily-report', () => 'reported')] })
    class ReportsApp {}
    load.mockResolvedValue(loaded(normalizeEsmExport({ default: ReportsApp })));
    const srv = await createGateway();

    expect(await reportOf(srv, 'daily-report')).toBe('reported');
  });

  it("runs only the ESM app's own hooks for its jobs", async () => {
    load.mockResolvedValue(loaded({ jobs: [reportJob('daily-report', () => 'reported')] }));
    const srv = await createGateway();
    const scope = scopeOf(srv);
    const job = scope.jobs?.findByName('daily-report');

    expect(ExecuteJobFlow.resolveHookOwnerId({ job }, scope)).toBe('acme');
  });

  it('stops the server when the package exports a job or a workflow that is not one', async () => {
    load.mockResolvedValue(loaded({ jobs: [{ name: 'daily-report' }] }));
    await expect(createGateway()).rejects.toThrow(/job/);

    class Undecorated {}
    load.mockResolvedValue(loaded({ workflows: [Undecorated] }));
    await expect(createGateway()).rejects.toThrow(/workflow/);
  });
});

describe('App.esm() jobs and workflows across versions', () => {
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

  async function startPolling(
    first: EsmLoadResult,
    jobs?: { enabled: boolean },
  ): Promise<{ srv: DirectMcpServer; poll: () => Promise<void> }> {
    load.mockResolvedValueOnce(first);
    const { FrontMcpInstance } = await import('../../front-mcp/front-mcp');
    server = await FrontMcpInstance.createDirect({
      info: { name: 'esm-gateway', version: '1.0.0' },
      apps: [App.esm('@acme/tools@^1.0.0', { namespace: 'acme', autoUpdate: { enabled: true } })],
      ...(jobs ? { jobs } : {}),
    });
    const started = poller;
    if (!started) throw new Error('the version poller did not start');
    return { srv: server, poll: () => started.poll() };
  }

  it("replaces the old version's jobs and workflows with the new version's", async () => {
    const { srv, poll } = await startPolling(
      loaded({
        jobs: [reportJob('daily-report', () => 'v1'), reportJob('purge-data', () => 'purged')],
        workflows: [reportFlow('purge', 'purge-data')],
      }),
    );
    load.mockResolvedValueOnce(
      loaded(
        { jobs: [reportJob('daily-report', () => 'v2')], workflows: [reportFlow('daily', 'daily-report')] },
        '1.1.0',
      ),
    );

    await poll();

    expect(jobNames(srv)).toEqual(['daily-report']);
    expect(await reportOf(srv, 'daily-report')).toBe('v2');
    expect(
      scopeOf(srv)
        .workflows?.getWorkflows(true)
        .map((workflow) => workflow.name),
    ).toEqual(['daily']);
    expect((await srv.executeWorkflow('daily', {})).structuredContent).toMatchObject({ state: 'completed' });
  });

  it('starts the job system for the first jobs a new version brings', async () => {
    const { srv, poll } = await startPolling(loaded({ tools: [{ name: 'echo', execute: async () => 'echo' }] }));
    expect(scopeOf(srv).jobs).toBeUndefined();
    load.mockResolvedValueOnce(loaded({ jobs: [reportJob('daily-report', () => 'new')] }, '1.1.0'));

    await poll();

    expect((await srv.listTools()).tools.map((tool) => tool.name)).toContain('execute_job');
    expect(await reportOf(srv, 'daily-report')).toBe('new');
  });

  it('serves no job a new version brings when the server sets jobs.enabled: false', async () => {
    const echoTool = { name: 'echo', execute: async () => 'echo' };
    const { srv, poll } = await startPolling(loaded({ tools: [echoTool] }), { enabled: false });
    load.mockResolvedValueOnce(loaded({ tools: [echoTool], jobs: [reportJob('daily-report', () => 'new')] }, '1.1.0'));

    await poll();

    expect(scopeOf(srv).jobs).toBeUndefined();
    expect((await srv.listTools()).tools.map((tool) => tool.name)).toEqual(['acme:echo']);
  });

  it('lets a job run that started on the old version finish on it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { srv, poll } = await startPolling(
      loaded({
        jobs: [
          reportJob('daily-report', async () => {
            started();
            await gate;
            return 'v1';
          }),
        ],
      }),
    );
    load.mockResolvedValueOnce(loaded({ jobs: [reportJob('daily-report', () => 'v2')] }, '1.1.0'));

    const inFlight = reportOf(srv, 'daily-report');
    await running;
    await poll();
    release();

    expect(await inFlight).toBe('v1');
    expect(await reportOf(srv, 'daily-report')).toBe('v2');
  });

  it('keeps the loaded version when the new one exports a job that is not one', async () => {
    const { srv, poll } = await startPolling(loaded({ jobs: [reportJob('daily-report', () => 'v1')] }));
    load.mockResolvedValueOnce(loaded({ jobs: [reportJob('daily-report', () => 'v2'), 'not-a-job'] }, '1.1.0'));

    await poll();

    expect(await reportOf(srv, 'daily-report')).toBe('v1');
  });
});

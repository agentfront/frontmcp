/**
 * Jobs run with the caller's request context (#705): `this.context` and CONTEXT-scoped providers,
 * such as the Remember and FeatureFlag accessors, resolve inside a job started by `execute_job` or
 * `execute_workflow`. Up to 1.9.1 the job got the app's plain provider registry, where
 * `this.context` threw `RequestContextNotAvailableError` and CONTEXT providers threw
 * `ProviderScopedAccessError`. A background run outlives the request, so it gets a context of its
 * own that keeps the caller's session and auth.
 */
import 'reflect-metadata';

import { App, Job, JobContext, LogLevel, ProviderScope, Workflow } from '../../common';
import { FRONTMCP_CONTEXT, type FrontMcpContext } from '../../context';
import { type DirectMcpServer } from '../../direct/direct.types';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';
import { type JobExecutionManager } from '../execution/job-execution.manager';

abstract class CallerSession {
  abstract readonly sessionId: string;
}

interface ContextReport {
  sessionId: string;
  requestId: string;
  providerSessionId: string;
}

@Job({ name: 'report_context', inputSchema: {}, outputSchema: {} })
class ReportContextJob extends JobContext {
  async execute(): Promise<ContextReport> {
    return {
      sessionId: this.context.sessionId,
      requestId: this.context.requestId,
      providerSessionId: this.get(CallerSession).sessionId,
    };
  }
}

@Workflow({ name: 'report_context_flow', steps: [{ id: 'report', jobName: 'report_context' }] })
class ReportContextWorkflow {}

@App({
  id: 'desk',
  name: 'Desk',
  jobs: [ReportContextJob],
  workflows: [ReportContextWorkflow],
  providers: [
    {
      provide: CallerSession,
      name: 'CallerSession',
      scope: ProviderScope.CONTEXT,
      inject: () => [FRONTMCP_CONTEXT] as const,
      useFactory: (ctx: FrontMcpContext) => ({ sessionId: ctx.sessionId }),
    },
  ],
})
class DeskApp {}

interface RunResult {
  runId: string;
  state: string;
  result?: unknown;
}

describe('jobs run with the request context (#705)', () => {
  let server: DirectMcpServer;
  let executionManager: JobExecutionManager;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect({
      info: { name: 'job-request-context', version: '1.0.0' },
      apps: [DeskApp],
      logging: { level: LogLevel.Off },
    });
    const scope = (server as unknown as { scope: Scope & { _jobExecutionManager?: JobExecutionManager } }).scope;
    if (!scope._jobExecutionManager) throw new Error('jobs are not enabled');
    executionManager = scope._jobExecutionManager;
  });

  afterAll(async () => {
    await server.dispose();
  });

  async function waitForRun(runId: string) {
    for (let poll = 0; poll < 100; poll++) {
      const run = await executionManager.getStatus(runId);
      if (run && (run.state === 'completed' || run.state === 'failed')) return run;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`run ${runId} did not finish`);
  }

  it('gives an inline job this.context and the CONTEXT providers of its app', async () => {
    const response = await server.callTool('execute_job', { name: 'report_context', input: {} });
    const run = response.structuredContent as unknown as RunResult;

    expect(run.state).toBe('completed');
    const report = run.result as ContextReport;
    expect(report.sessionId).toEqual(expect.any(String));
    expect(report.providerSessionId).toBe(report.sessionId);
  });

  it('gives a background job a context of its own with the caller session', async () => {
    const inline = (await server.callTool('execute_job', { name: 'report_context', input: {} }))
      .structuredContent as unknown as RunResult;
    const response = await server.callTool('execute_job', { name: 'report_context', input: {}, background: true });
    const { runId } = response.structuredContent as unknown as RunResult;

    const run = await waitForRun(runId);

    expect(run.state).toBe('completed');
    const report = run.result as ContextReport;
    const inlineReport = inline.result as ContextReport;
    expect(report.sessionId).toBe(inlineReport.sessionId);
    expect(report.providerSessionId).toBe(report.sessionId);
  });

  it('gives a workflow step this.context and the CONTEXT providers of its app', async () => {
    const response = await server.callTool('execute_workflow', { name: 'report_context_flow' });
    const run = response.structuredContent as unknown as RunResult;

    expect(run.state).toBe('completed');
    const stepOutputs = JSON.stringify(run.result);
    expect(stepOutputs).toContain('providerSessionId');
  });
});

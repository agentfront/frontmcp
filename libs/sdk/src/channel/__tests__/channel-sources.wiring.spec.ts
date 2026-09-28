/**
 * The `webhook`, `agent-completion` and `job-completion` channel sources reach their channels.
 *
 * The three sources were declared, documented and implemented (`createWebhookMiddleware`,
 * `wireAgentCompletionSource`, `wireJobCompletionSource`), but never wired: no HTTP route was
 * registered for a webhook path, and the scope never gave the channel helper an agent or job
 * completion subscription, so these channels never received an event.
 */
import 'reflect-metadata';

import * as http from 'node:http';
import { type AddressInfo } from 'node:net';

import { z } from '@frontmcp/lazy-zod';

import {
  Agent,
  AgentContext,
  App,
  Channel,
  ChannelContext,
  Job,
  JobContext,
  LogLevel,
  type ChannelNotification,
  type FrontMcpConfigInput,
} from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { type Scope } from '../../scope/scope.instance';

const received: Array<{ channel: string; payload: Record<string, unknown> }> = [];

function record(channel: string, payload: unknown): ChannelNotification {
  received.push({ channel, payload: payload as Record<string, unknown> });
  return { content: `${channel} got it` };
}

@Channel({ name: 'deploys', source: { type: 'webhook', path: '/hooks/deploy' } })
class DeployChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return record('deploys', payload);
  }
}

@Channel({ name: 'reviews-done', source: { type: 'agent-completion', agentIds: ['reviewer'] } })
class ReviewsDoneChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return record('reviews-done', payload);
  }
}

@Channel({ name: 'reports-done', source: { type: 'job-completion', jobNames: ['daily_report'] } })
class ReportsDoneChannel extends ChannelContext {
  async onEvent(payload: unknown): Promise<ChannelNotification> {
    return record('reports-done', payload);
  }
}

const answering = { completion: async () => ({ content: 'looks good', finishReason: 'stop' as const }) };
const failing = {
  completion: async (): Promise<never> => {
    throw new Error('model unavailable');
  },
};

@Agent({ name: 'reviewer', inputSchema: {}, llm: { adapter: answering } })
class ReviewerAgent extends AgentContext {}

@Agent({ name: 'broken_reviewer', inputSchema: {}, llm: { adapter: failing } })
class BrokenReviewerAgent extends AgentContext {}

@Agent({ name: 'summarizer', inputSchema: {}, llm: { adapter: answering } })
class SummarizerAgent extends AgentContext {}

@Job({ name: 'daily_report', inputSchema: {}, outputSchema: { rows: z.number() } })
class DailyReportJob extends JobContext {
  async execute() {
    return { rows: 3 };
  }
}

@Job({ name: 'cleanup', inputSchema: {}, outputSchema: { ok: z.boolean() } })
class CleanupJob extends JobContext {
  async execute() {
    return { ok: true };
  }
}

@App({
  id: 'ops',
  name: 'Ops',
  agents: [ReviewerAgent, BrokenReviewerAgent, SummarizerAgent],
  jobs: [DailyReportJob, CleanupJob],
  channels: [DeployChannel, ReviewsDoneChannel, ReportsDoneChannel],
})
class OpsApp {}

const config: FrontMcpConfigInput = {
  info: { name: 'channel-sources', version: '1.0.0' },
  apps: [OpsApp],
  logging: { level: LogLevel.Off },
  jobs: { enabled: true },
  channels: { enabled: true },
};

/** Wait for a fire-and-forget channel delivery. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  received.length = 0;
});

describe('webhook source', () => {
  let node: http.Server;
  let base: string;

  async function listen(extra: Pick<FrontMcpConfigInput, 'throttle'> = {}): Promise<void> {
    const app = (await FrontMcpInstance.createHandler({ ...config, ...extra })) as http.RequestListener;
    node = http.createServer(app);
    await new Promise<void>((resolve) => node.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      node.close(() => resolve());
      node.closeAllConnections();
    });
  });

  it('serves the webhook path and hands the request to the channel', async () => {
    await listen();

    const response = await fetch(`${base}/hooks/deploy?env=prod`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Deploy-Id': 'd-7' },
      body: JSON.stringify({ status: 'ok', version: '1.2.3' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, channel: 'deploys' });
    expect(received).toEqual([
      {
        channel: 'deploys',
        payload: expect.objectContaining({
          body: { status: 'ok', version: '1.2.3' },
          method: 'POST',
          headers: expect.objectContaining({ 'x-deploy-id': 'd-7' }),
          query: { env: 'prod' },
        }),
      },
    ]);
  });

  it('runs the throttle.ipFilter check before the channel', async () => {
    await listen({ throttle: { enabled: true, ipFilter: { denyList: ['127.0.0.1'] } } });

    const response = await fetch(`${base}/hooks/deploy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'ok' }),
    });

    expect(response.status).toBe(403);
    expect(received).toEqual([]);
  });

  it('refuses to start with a webhook path on a reserved FrontMCP path', async () => {
    @Channel({ name: 'bad-hook', source: { type: 'webhook', path: '/oauth/hooks' } })
    class BadHookChannel extends ChannelContext {
      async onEvent(payload: unknown): Promise<ChannelNotification> {
        return record('bad-hook', payload);
      }
    }
    @App({ id: 'bad', name: 'Bad', channels: [BadHookChannel] })
    class BadApp {}

    await expect(FrontMcpInstance.createHandler({ ...config, apps: [BadApp] })).rejects.toThrow(/\/oauth/);
  });

  it('refuses to start with two channels on one webhook path', async () => {
    @Channel({ name: 'deploys-too', source: { type: 'webhook', path: '/hooks/deploy' } })
    class SecondDeployChannel extends ChannelContext {
      async onEvent(payload: unknown): Promise<ChannelNotification> {
        return record('deploys-too', payload);
      }
    }
    @App({ id: 'twice', name: 'Twice', channels: [DeployChannel, SecondDeployChannel] })
    class TwiceApp {}

    await expect(FrontMcpInstance.createHandler({ ...config, apps: [TwiceApp] })).rejects.toThrow(
      /both declare the webhook path \/hooks\/deploy/,
    );
  });
});

describe('agent-completion and job-completion sources', () => {
  let server: Awaited<ReturnType<typeof FrontMcpInstance.createDirect>>;

  beforeAll(async () => {
    server = await FrontMcpInstance.createDirect(config);
  });

  afterAll(async () => {
    await server.dispose();
  });

  it('tells the channel when an agent it follows finishes, for the calling session', async () => {
    await server.callTool('invoke_reviewer', {}, { authContext: { sessionId: 'session-a' } });
    await settle();

    expect(received).toEqual([
      {
        channel: 'reviews-done',
        payload: expect.objectContaining({
          agentId: 'reviewer',
          agentName: 'reviewer',
          status: 'success',
          sessionId: 'session-a',
          output: expect.stringContaining('looks good'),
        }),
      },
    ]);
  });

  it('reports a failed agent run as an error', async () => {
    @Channel({ name: 'broken-done', source: { type: 'agent-completion', agentIds: ['broken_reviewer'] } })
    class BrokenDoneChannel extends ChannelContext {
      async onEvent(payload: unknown): Promise<ChannelNotification> {
        return record('broken-done', payload);
      }
    }
    @App({ id: 'broken', name: 'Broken', agents: [BrokenReviewerAgent], channels: [BrokenDoneChannel] })
    class BrokenApp {}
    const broken = await FrontMcpInstance.createDirect({ ...config, apps: [BrokenApp] });
    try {
      await broken
        .callTool('invoke_broken_reviewer', {}, { authContext: { sessionId: 'session-b' } })
        .catch(() => undefined);
      await settle();

      expect(received).toEqual([
        {
          channel: 'broken-done',
          payload: expect.objectContaining({ agentId: 'broken_reviewer', status: 'error', sessionId: 'session-b' }),
        },
      ]);
    } finally {
      await broken.dispose();
    }
  });

  it('leaves out agents the channel does not follow', async () => {
    await server.callTool('invoke_summarizer', {}, { authContext: { sessionId: 'session-a' } });
    await settle();

    expect(received).toEqual([]);
  });

  it('tells the channel when a job it follows completes, for the session that ran it', async () => {
    await server.callTool('execute_job', { name: 'daily_report' }, { authContext: { sessionId: 'session-c' } });
    await settle();

    expect(received).toEqual([
      {
        channel: 'reports-done',
        payload: expect.objectContaining({
          jobName: 'daily_report',
          status: 'success',
          sessionId: 'session-c',
          output: expect.stringContaining('"rows":3'),
        }),
      },
    ]);
  });

  it('leaves out jobs the channel does not follow', async () => {
    await server.callTool('execute_job', { name: 'cleanup' }, { authContext: { sessionId: 'session-c' } });
    await settle();

    expect(received).toEqual([]);
  });

  it('delivers a job completion only to the session that ran the job, never to everyone', async () => {
    const scope = (server as unknown as { scope: Scope }).scope;
    const manager = (scope as unknown as { _jobExecutionManager: { executeJob: Function } })._jobExecutionManager;
    const job = scope.jobs?.findByName('daily_report');
    if (!job) throw new Error('daily_report job missing');

    await manager.executeJob(job, {}, {});
    await settle();

    expect(received).toEqual([]);
  });
});

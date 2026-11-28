/**
 * #1446: a DELETE that lands on an instance which does not hold the session answers only once the
 * instance holding it has stopped the session's calls in flight, or, when that instance does not confirm
 * it in time, with a retryable 503 (never a 204 while the calls may still run).
 *
 * Two instances run the persistent-questions server; the session's call waits on a question on one
 * of them (the holder) and the DELETE goes to the other:
 * - the default mode: the instances share the session store only (no bus);
 * - the distributed mode: the DELETE is not relayed (the holder's heartbeat lapsed), so the other node
 *   asks the holder over the bus to close the session.
 *
 * On a Redis container, and on a Redis Cluster when REDIS_CLUSTER_NODES lists its nodes
 * (`scripts/redis-cluster-docker.sh up`).
 */

import Redis, { Cluster } from 'ioredis';

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { DistributedTestCluster, type ClusterNode } from '../../../../libs/testing/src/server/distributed-test-cluster';
import { callTool, initializeSession, toolText, waitFor, type McpHttpResponse } from './helpers/mcp-http';

const SKIP = shouldSkipDistributedTests();
const CLUSTER_NODES = (process.env['REDIS_CLUSTER_NODES'] ?? '')
  .split(',')
  .map((node) => node.trim())
  .filter(Boolean);
const INBOX_LINK = /question inbox sign-in link: (\S+)/;
/** HA keys of their own, so other servers on a shared Redis Cluster never receive this spec's messages. */
const HA_KEY_PREFIX = 'mcp:ha:e2e-delete-in-flight:';

const SESSION_SECRET = { MCP_SESSION_SECRET: 'delete-in-flight-e2e-session-secret-0123456789abcdef' };
const DISTRIBUTED_ENV = {
  ...SESSION_SECRET,
  FRONTMCP_DEPLOYMENT_MODE: 'distributed',
  FRONTMCP_HA_HEARTBEAT_INTERVAL_MS: '1000',
  FRONTMCP_HA_HEARTBEAT_TTL_MS: '3000',
  FRONTMCP_HA_KEY_PREFIX: HA_KEY_PREFIX,
};

interface InboxQuestion {
  id: string;
  key: string;
  answered: boolean;
}

interface Backend {
  /** Start the Redis the instances share; resolves its URL, the instances' extra env and a test client. */
  start(): Promise<{ url: string; env: Record<string, string>; client: Redis | Cluster; stop(): Promise<void> }>;
}

const containerBackend: Backend = {
  async start() {
    const container: RedisContainerInfo = await startRedisContainer();
    const client = new Redis(container.url);
    return {
      url: container.url,
      env: {},
      client,
      stop: async () => {
        client.disconnect();
        await container.stop();
      },
    };
  },
};

const clusterBackend: Backend = {
  async start() {
    const [host, port] = (CLUSTER_NODES[0] ?? '127.0.0.1:7101').split(':');
    const client = new Cluster([{ host, port: Number(port) }]);
    return {
      url: `redis://${host}:${port}`,
      env: { REDIS_CLUSTER: '1' },
      client,
      stop: async () => {
        client.disconnect();
      },
    };
  },
};

const backends: Array<[string, Backend]> = [
  ['a Redis container', containerBackend],
  ...(CLUSTER_NODES.length > 0 ? [['a Redis Cluster', clusterBackend] as [string, Backend]] : []),
];

/** Whether `call` settles within `ms`; a call still waiting on its question does not. */
async function settlesWithin(call: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([call.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function deleteSession(node: ClusterNode, sessionId: string): Promise<Response> {
  return fetch(`${node.info.baseUrl}/`, { method: 'DELETE', headers: { 'mcp-session-id': sessionId } });
}

const describeIf = SKIP ? describe.skip : describe;

describeIf.each(backends)('A DELETE through another instance, on %s', (_backend, backend) => {
  describe.each([
    ['the default mode', SESSION_SECRET],
    ['distributed mode', DISTRIBUTED_ENV],
  ])('(%s)', (mode, env) => {
    const distributed = mode === 'distributed mode';
    let redis: Awaited<ReturnType<Backend['start']>>;
    let cluster: DistributedTestCluster;
    let nodes: ClusterNode[];

    beforeAll(async () => {
      redis = await backend.start();
      cluster = new DistributedTestCluster({
        redisUrl: redis.url,
        serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.questions.ts',
        project: 'demo-e2e-distributed',
        env: { ...env, ...redis.env },
      });
      nodes = await cluster.start(2);
    }, 180_000);

    afterAll(async () => {
      await cluster?.teardown();
      await redis?.stop();
    });

    /** Sign a person in to the session's inbox on `node`, with the link the session's call printed there. */
    async function signIn(node: ClusterNode, sessionId: string): Promise<string> {
      const printedBefore = node.server.getLogs().length;
      await callTool(node.info.baseUrl, sessionId, 'inbox-link', {});
      let link = '';
      await waitFor(async () => {
        const line = node.server
          .getLogs()
          .slice(printedBefore)
          .find((entry) => INBOX_LINK.test(entry));
        link = line ? (INBOX_LINK.exec(line) as RegExpExecArray)[1] : '';
        return link !== '';
      }, 30_000);
      const code = new URL(link, node.info.baseUrl).searchParams.get('code') ?? '';
      const login = await fetch(`${node.info.baseUrl}/_frontmcp/people/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: node.info.baseUrl },
        body: new URLSearchParams({ code }).toString(),
        redirect: 'manual',
      });
      expect(login.status).toBe(200);
      return (login.headers.get('set-cookie') ?? '').split(';')[0];
    }

    async function inbox(node: ClusterNode, cookie: string): Promise<InboxQuestion[]> {
      const response = await fetch(`${node.info.baseUrl}/_frontmcp/questions`, { headers: { Cookie: cookie } });
      return ((await response.json()) as { questions: InboxQuestion[] }).questions;
    }

    async function answer(node: ClusterNode, cookie: string, questionId: string): Promise<number> {
      const answered = await fetch(`${node.info.baseUrl}/_frontmcp/questions/${questionId}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: node.info.baseUrl },
        body: JSON.stringify({ action: 'accept', content: { approve: true } }),
      });
      return answered.status;
    }

    /** A session on `holder` whose call waits on the question `deploy-<version>`. */
    async function sessionWithWaitingCall(holder: ClusterNode, version: string) {
      const sessionId = await initializeSession(holder.info.baseUrl);
      const cookie = await signIn(holder, sessionId);
      const call: Promise<McpHttpResponse> = callTool(holder.info.baseUrl, sessionId, 'approve-deploy', { version });
      // Settled either way: a call the holder stops ends its stream without an answer
      const settled = call.then(
        (response) => response,
        () => undefined,
      );
      let question: InboxQuestion | undefined;
      await waitFor(async () => {
        question = (await inbox(holder, cookie)).find((candidate) => candidate.key === `deploy-${version}`);
        return question !== undefined;
      }, 30_000);
      return { sessionId, cookie, settled, question: question as InboxQuestion };
    }

    it("stops the session's call on the instance holding it before the DELETE answers", async () => {
      const [holder, other] = nodes;
      const { sessionId, cookie, settled, question } = await sessionWithWaitingCall(holder, '2.0.0');

      const deleted = await deleteSession(other, sessionId);

      expect(deleted.status).toBe(204);
      // The call's question waits 60 s: a call still running would not end now
      expect(await settlesWithin(settled, 2_000)).toBe(true);
      expect(await answer(holder, cookie, question.id)).toBe(200);
      expect(toolText((await settled) ?? ({} as McpHttpResponse))).not.toContain('approved');
      expect(await inbox(holder, cookie)).toEqual([expect.objectContaining({ key: 'deploy-2.0.0', answered: true })]);
    });

    it('answers 503 with Retry-After while the holder does not confirm, and 204 once it stopped the call', async () => {
      const [holder, other] = nodes;
      const { sessionId, cookie, settled, question } = await sessionWithWaitingCall(holder, '3.0.0');
      // The process group the spawn shell leads holds the server, whichever process lsof found listening
      const group = -(holder.info.shellPid as number);

      // The holder stops answering, and stays connected to Redis
      process.kill(group, 'SIGSTOP');
      let unconfirmed: Response;
      try {
        // Distributed: its heartbeat lapsed too, so the DELETE is not relayed to it but sent over the bus
        if (distributed) await redis.client.del(`${HA_KEY_PREFIX}heartbeat:${holder.machineId}`);
        unconfirmed = await deleteSession(other, sessionId);
      } finally {
        process.kill(group, 'SIGCONT');
      }

      expect(unconfirmed.status).toBe(503);
      expect(Number(unconfirmed.headers.get('retry-after'))).toBeGreaterThan(0);
      const body = (await unconfirmed.json()) as { error?: { message?: string } };
      expect(body.error?.message).toContain('Retry');

      // Running again, the holder closes the session; the retried DELETE answers 204 once it has
      let retried: Response | undefined;
      await waitFor(async () => {
        retried = await deleteSession(other, sessionId);
        return retried.status === 204;
      }, 30_000);
      expect(await settlesWithin(settled, 2_000)).toBe(true);
      expect(await answer(holder, cookie, question.id)).toBe(200);
      expect(toolText((await settled) ?? ({} as McpHttpResponse))).not.toContain('approved');
      expect(await inbox(holder, cookie)).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'deploy-3.0.0', answered: true })]),
      );
    });
  });
});

/** #1446: a call waiting on a question must not take its answer once a DELETE through the other instance ended it. */

import {
  shouldSkipDistributedTests,
  startRedisContainer,
  type RedisContainerInfo,
} from '../../../../libs/testing/src/containers/redis-container';
import { DistributedTestCluster, type ClusterNode } from '../../../../libs/testing/src/server/distributed-test-cluster';
import { callTool, initializeSession, toolText, waitFor } from './helpers/mcp-http';

const SKIP = shouldSkipDistributedTests();
const skipIf = (condition: boolean) => (condition ? it.skip : it);
const INBOX_LINK = /question inbox sign-in link: (\S+)/;

const SESSION_SECRET = { MCP_SESSION_SECRET: 'shared-store-questions-e2e-secret-0123456789abcdef' };
const DISTRIBUTED_ENV = {
  ...SESSION_SECRET,
  FRONTMCP_DEPLOYMENT_MODE: 'distributed',
  FRONTMCP_HA_HEARTBEAT_INTERVAL_MS: '1000',
  FRONTMCP_HA_HEARTBEAT_TTL_MS: '3000',
};

interface InboxQuestion {
  id: string;
  key: string;
  answered: boolean;
}

describe.each([
  ['the default mode', SESSION_SECRET],
  ['distributed mode', DISTRIBUTED_ENV],
])('Persistent questions across instances sharing a store (%s)', (_mode, env) => {
  let redisContainer: RedisContainerInfo;
  let cluster: DistributedTestCluster;
  let nodes: ClusterNode[];

  beforeAll(async () => {
    if (SKIP) return;
    redisContainer = await startRedisContainer();
    cluster = new DistributedTestCluster({
      redisUrl: redisContainer.url,
      serverEntry: 'apps/e2e/demo-e2e-distributed/src/main.questions.ts',
      project: 'demo-e2e-distributed',
      env,
    });
    nodes = await cluster.start(2);
  }, 180_000);

  afterAll(async () => {
    if (SKIP) return;
    await cluster?.teardown();
    await redisContainer?.stop();
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

  skipIf(SKIP)('keeps the answer from a call whose session was deleted through the other instance', async () => {
    const [holder, other] = nodes;
    const sessionId = await initializeSession(holder.info.baseUrl);
    const cookie = await signIn(holder, sessionId);

    const waiting = callTool(holder.info.baseUrl, sessionId, 'approve-deploy', { version: '1.0.0' });
    let question: InboxQuestion | undefined;
    await waitFor(async () => {
      question = (await inbox(holder, cookie)).find((candidate) => candidate.key === 'deploy-1.0.0');
      return question !== undefined;
    }, 30_000);

    const deleted = await fetch(`${other.info.baseUrl}/`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sessionId },
    });
    expect(deleted.status).toBe(204);
    const answered = await fetch(`${holder.info.baseUrl}/_frontmcp/questions/${question?.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: holder.info.baseUrl },
      body: JSON.stringify({ action: 'accept', content: { approve: true } }),
    });
    expect(answered.status).toBe(200);

    expect(toolText(await waiting)).not.toContain('approved');
    expect(await inbox(holder, cookie)).toEqual([expect.objectContaining({ key: 'deploy-1.0.0', answered: true })]);
  });
});

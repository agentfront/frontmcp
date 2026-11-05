import 'reflect-metadata';

import { CREDENTIALS_ACCESSOR } from '@frontmcp/auth';
import { z } from '@frontmcp/lazy-zod';

import { createTestFetchServer, rpc20260728 } from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, Tool, ToolContext } from '../../../common';

const CONNECT_URL = 'https://server.example/oauth/connect?token=signed';
const connectedProviders = new Set<string>();

const credentialsAccessor = {
  requireConnect: async ({ key }: { key: string }) =>
    connectedProviders.has(key) ? { connected: true, key } : { connected: false, key, resumeUrl: CONNECT_URL },
};

@Tool({ name: 'deploy', inputSchema: {}, authProviders: ['github'] })
class DeployTool extends ToolContext {
  async execute() {
    return { deployed: true };
  }
}

@Tool({ name: 'deploy_confirmed', inputSchema: {}, authProviders: ['github'] })
class DeployConfirmedTool extends ToolContext {
  async execute() {
    const answer = await this.elicit('Deploy now?', z.object({ confirmed: z.boolean() }));
    return { confirmed: answer.content?.confirmed === true };
  }
}

@App({
  id: 'cloud',
  name: 'Cloud',
  tools: [DeployTool, DeployConfirmedTool],
  providers: [{ provide: CREDENTIALS_ACCESSOR, useValue: credentialsAccessor }],
})
class CloudApp {}

const config = {
  info: { name: 'credential-gate-url-elicitation', version: '1.0.0' },
  apps: [CloudApp],
  logging: { level: LogLevel.Off },
  elicitation: { enabled: true },
};

const URL_ELICITATION = { capabilities: { elicitation: { form: {}, url: {} } } };

describe('the credential gate under MCP 2026-07-28', () => {
  beforeEach(() => connectedProviders.clear());

  it('asks a client that declared URL-mode elicitation to open the connect page', async () => {
    const server = await createTestFetchServer(config);
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'deploy', arguments: {} },
      URL_ELICITATION,
    );

    const inputRequests = message.result?.['inputRequests'] as Record<string, { params: Record<string, unknown> }>;
    expect(Object.keys(inputRequests)).toEqual(['connect-github']);
    expect(inputRequests['connect-github'].params).toEqual(
      expect.objectContaining({
        mode: 'url',
        url: CONNECT_URL,
        message: 'Connect github to continue: tool "cloud:deploy" needs it.',
        elicitationId: expect.any(String),
      }),
    );
  });

  it('runs the tool on the retry once the credential is connected', async () => {
    const server = await createTestFetchServer(config);
    connectedProviders.add('github');
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'deploy', arguments: {}, inputResponses: { 'connect-github': { action: 'accept' } } },
      URL_ELICITATION,
    );

    expect(message.result?.['structuredContent']).toEqual({ deployed: true });
  });

  it('answers -32001 on the retry when the user declined, with the URL in the data only', async () => {
    const server = await createTestFetchServer(config);
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'deploy', arguments: {}, inputResponses: { 'connect-github': { action: 'decline' } } },
      URL_ELICITATION,
    );

    expect(message.error?.code).toBe(-32001);
    expect(message.error?.message).not.toContain(CONNECT_URL);
    expect(message.error?.data).toEqual(expect.objectContaining({ providers: ['github'], authUrl: CONNECT_URL }));
  });

  it('answers -32001 without asking a client that declared only form elicitation', async () => {
    const server = await createTestFetchServer(config);
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'deploy', arguments: {} },
      { capabilities: { elicitation: { form: {} } } },
    );

    expect(message.result?.['inputRequests']).toBeUndefined();
    expect(message.error?.code).toBe(-32001);
  });

  it("keeps the tool's own question apart from the connect page's answer", async () => {
    const server = await createTestFetchServer(config);
    connectedProviders.add('github');
    const { message } = await rpc20260728(
      server.handler,
      'tools/call',
      { name: 'deploy_confirmed', arguments: {}, inputResponses: { 'connect-github': { action: 'accept' } } },
      URL_ELICITATION,
    );

    const inputRequests = message.result?.['inputRequests'] as Record<string, { params: Record<string, unknown> }>;
    expect(Object.keys(inputRequests)).toEqual(['elicitation-1']);
    expect(inputRequests['elicitation-1'].params).toEqual(expect.objectContaining({ message: 'Deploy now?' }));
  });
});

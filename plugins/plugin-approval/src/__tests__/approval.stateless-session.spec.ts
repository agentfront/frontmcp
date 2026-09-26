/** Stateless session approvals without `mcp-session-id` are keyed by principal, over real in-process HTTP (#597). */
import 'reflect-metadata';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import { z } from '@frontmcp/lazy-zod';
import {
  App,
  FrontMcpInstance,
  LogLevel,
  Tool,
  ToolContext,
  type DirectAuthContext,
  type PluginType,
} from '@frontmcp/sdk';
import { createMemoryStorage } from '@frontmcp/utils';

import { ApprovalPlugin } from '../index';

const ISSUER = 'https://auth.example.com';
const PROTOCOL_2026_07_28 = '2026-07-28';
const PROTOCOL_2025_06_18 = '2025-06-18';

/** The gate keys approvals by the tool's full name, which includes its app id. */
const DEPLOY_TOOL_ID = 'ops:deploy_service';

const executedDeployments: string[] = [];

@Tool({
  name: 'deploy_service',
  description: 'Deploys a service',
  inputSchema: { service: z.string() },
  approval: { required: true },
})
class DeployServiceTool extends ToolContext {
  async execute(input: { service: string }) {
    executedDeployments.push(input.service);
    return { deployed: input.service };
  }
}

@Tool({ name: 'approve_deploy', description: 'Grants this caller session approval to deploy', inputSchema: {} })
class ApproveDeployTool extends ToolContext {
  async execute() {
    await this.approval.grantSessionApproval(DEPLOY_TOOL_ID);
    return { approved: true };
  }
}

function opsApp(plugins: PluginType[]) {
  @App({ id: 'ops', name: 'Ops', plugins, tools: [DeployServiceTool, ApproveDeployTool] })
  class OpsApp {}
  return OpsApp;
}

interface TokenIssuer {
  jwks: { keys: JWK[] };
  tokenFor(subject: string): Promise<string>;
}

async function createTokenIssuer(): Promise<TokenIssuer> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'approval-spec', alg: 'RS256', use: 'sig' };
  return {
    jwks: { keys: [jwk] },
    tokenFor: (subject) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'approval-spec' })
        .setIssuer(ISSUER)
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey),
  };
}

type FetchHandler = (request: Request) => Promise<Response>;

let nextRequestId = 1;

/** A JSON-RPC POST without `mcp-session-id`, answered by the server's HTTP entry point. */
async function post(
  handler: FetchHandler,
  token: string,
  protocolVersion: string,
  method: string,
  params: Record<string, unknown>,
): Promise<string> {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
        'mcp-protocol-version': protocolVersion,
        'mcp-method': method,
        ...(typeof params['name'] === 'string' ? { 'mcp-name': params['name'] } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextRequestId++, method, params }),
    }),
  );
  return response.text();
}

function callToolRequest(protocolVersion: string, name: string, args: Record<string, unknown>) {
  const meta =
    protocolVersion === PROTOCOL_2026_07_28
      ? {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': PROTOCOL_2026_07_28,
            'io.modelcontextprotocol/clientInfo': { name: 'approval-spec', version: '1.0.0' },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        }
      : {};
  return { name, arguments: args, ...meta };
}

describe.each([
  ['MCP 2026-07-28', PROTOCOL_2026_07_28],
  ['MCP 2025-06-18 served statelessly', PROTOCOL_2025_06_18],
])('session approval over %s without mcp-session-id (#597)', (_, protocolVersion) => {
  let issuer: TokenIssuer;
  let handler: FetchHandler;

  async function callTool(subject: string, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const token = await issuer.tokenFor(subject);
    if (protocolVersion === PROTOCOL_2025_06_18) {
      await post(handler, token, protocolVersion, 'initialize', {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'approval-spec', version: '1.0.0' },
      });
    }
    return post(handler, token, protocolVersion, 'tools/call', callToolRequest(protocolVersion, name, args));
  }

  beforeEach(async () => {
    executedDeployments.length = 0;
    issuer = await createTokenIssuer();
    const storage = createMemoryStorage();
    await storage.connect();
    handler = await FrontMcpInstance.createFetchHandler({
      info: { name: 'approval-stateless-session', version: '1.0.0' },
      apps: [opsApp([ApprovalPlugin.init({ storageInstance: storage })])],
      auth: { mode: 'transparent', provider: ISSUER, providerConfig: { jwks: issuer.jwks } },
      logging: { level: LogLevel.Off },
    });
  });

  it('refuses the tool before the caller is granted approval', async () => {
    const response = await callTool('alice', 'deploy_service', { service: 'api' });

    expect(response).toContain('requires approval');
    expect(executedDeployments).toEqual([]);
  });

  it('runs the tool in a later request after the same principal was granted session approval', async () => {
    expect(await callTool('alice', 'approve_deploy')).toContain('approved');

    await callTool('alice', 'deploy_service', { service: 'alice-api' });

    expect(executedDeployments).toEqual(['alice-api']);
  });

  it('does not let another principal use that approval', async () => {
    await callTool('alice', 'approve_deploy');

    const response = await callTool('bob', 'deploy_service', { service: 'bob-api' });

    expect(response).toContain('requires approval');
    expect(executedDeployments).toEqual([]);
  });
});

describe('session approval of a caller with a real session (#597)', () => {
  it('stays with the session that granted it', async () => {
    executedDeployments.length = 0;
    const storage = createMemoryStorage();
    await storage.connect();
    const server = await FrontMcpInstance.createDirect({
      info: { name: 'approval-real-session', version: '1.0.0' },
      apps: [opsApp([ApprovalPlugin.init({ storageInstance: storage })])],
      logging: { level: LogLevel.Off },
    });
    const sessionA: DirectAuthContext = { sessionId: 'session-a', user: { sub: 'alice' } };
    const sessionB: DirectAuthContext = { sessionId: 'session-b', user: { sub: 'alice' } };

    try {
      await server.callTool('approve_deploy', {}, { authContext: sessionA });
      await server.callTool('deploy_service', { service: 'from-b' }, { authContext: sessionB }).catch(() => undefined);
      await server.callTool('deploy_service', { service: 'from-a' }, { authContext: sessionA });
    } finally {
      await server.dispose();
    }

    expect(executedDeployments).toEqual(['from-a']);
  });
});

/**
 * The debug request log must not write credentials.
 *
 * With debug logging on, every HTTP request logs its headers. `authorization`, `cookie` and
 * `x-api-key` were redacted, but not the dashboard token header (`x-frontmcp-dashboard-token`), a
 * token URL the dashboard page's own requests carry in `Referer` (`/dashboard?token=…`), other
 * credential headers, or the session id the edge runtime forwards in `x-frontmcp-session-id`.
 */
import 'reflect-metadata';

import { inspect } from 'node:util';

import {
  createTestFetchServer,
  rpc20260728,
  type TestFetchServer,
} from '../../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, LogLevel, LogTransport, LogTransportInterface, Tool, ToolContext, type LogRecord } from '../../../common';

const captured: string[] = [];

@LogTransport({ name: 'HeaderRedactionCapture', description: 'Captures every log record for assertions' })
class CaptureLogTransport extends LogTransportInterface {
  log(record: LogRecord): void {
    captured.push(
      [record.message, ...record.args]
        .map((value) => (typeof value === 'string' ? value : inspect(value, { depth: 6, breakLength: Infinity })))
        .join(' '),
    );
  }
}

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return 'pong';
  }
}

@App({ id: 'probe', name: 'Probe', tools: [PingTool] })
class ProbeApp {}

const SESSION_ID = 'd9f1c2a4-7b3e-4f6a-9c8d-1e2f3a4b5c6d';
const MCP_SESSION_ID = '5e7a9c1b-2d4f-4a6c-8e0b-3f5d7c9a1e2b';

const SECRETS = {
  authorization: 'Bearer authorization-secret-0001',
  'proxy-authorization': 'Basic proxy-secret-0002',
  cookie: 'frontmcp_dashboard=cookie-secret-0003; mcp_session_id=cookie-secret-0004',
  'x-api-key': 'api-key-secret-0005',
  'x-frontmcp-dashboard-token': 'dashboard-token-secret-0006',
  'x-auth-token': 'auth-token-secret-0007',
  'x-access-token': 'access-token-secret-0008',
  'x-client-secret': 'client-secret-0009',
  referer: 'https://ops.example.com/dashboard?token=referer-token-secret-0010',
} as const;

function secretValues(): string[] {
  return [
    'authorization-secret-0001',
    'proxy-secret-0002',
    'cookie-secret-0003',
    'cookie-secret-0004',
    'api-key-secret-0005',
    'dashboard-token-secret-0006',
    'auth-token-secret-0007',
    'access-token-secret-0008',
    'client-secret-0009',
    'referer-token-secret-0010',
  ];
}

describe('debug request log', () => {
  let server: TestFetchServer;
  let log: string;

  beforeAll(async () => {
    server = await createTestFetchServer({
      info: { name: 'header-redaction', version: '1.0.0' },
      apps: [ProbeApp],
      logging: { level: LogLevel.Debug, enableConsole: false, transports: [CaptureLogTransport] },
    });
    captured.length = 0;
    await rpc20260728(
      server.handler,
      'tools/list',
      {},
      {
        headers: {
          ...SECRETS,
          'mcp-session-id': MCP_SESSION_ID,
          'x-frontmcp-session-id': SESSION_ID,
          'x-request-note': 'visible-header-value',
        },
      },
    );
    log = captured.join('\n');
  });

  it('logs the request headers', () => {
    expect(log).toContain('HEADERS');
    expect(log).toContain('visible-header-value');
  });

  it.each(secretValues())('does not write %s', (secret) => {
    expect(log).not.toContain(secret);
  });

  it.each([
    ['x-frontmcp-session-id', SESSION_ID],
    ['mcp-session-id', MCP_SESSION_ID],
  ])('logs the start of %s, never the whole id', (header, sessionId) => {
    expect(log).toContain(`'${header}': '${sessionId.slice(0, 8)}...'`);
    expect(log).not.toContain(sessionId);
  });

  it('keeps where a Referer came from, without its query', () => {
    expect(log).toContain('https://ops.example.com/dashboard');
  });
});

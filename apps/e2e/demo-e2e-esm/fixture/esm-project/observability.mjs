// An ES-module project ("type": "module") with observability (#802). Node loads @frontmcp/sdk's ESM
// bundle, which loads @frontmcp/observability with require(): its CommonJS bundle, which loads the
// SDK's CommonJS bundle, a second copy of every SDK class. The request log and the spans used to
// record every failure as GenericServerError with a new error id, while the client got the real one.
//
// Calls two failing tools and writes what the client got next to what observability recorded to the
// file named by RESULT_FILE.
import 'reflect-metadata';

import { trace } from '@opentelemetry/api';
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { z } from 'zod';

import { App, FrontMcpInstance, LogLevel, PublicMcpError, Tool, ToolContext } from '@frontmcp/sdk';
import { writeFile } from '@frontmcp/utils';

const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));

class CloseTicket extends ToolContext {
  async execute() {
    this.fail(new PublicMcpError('no such ticket'));
  }
}
Tool({ name: 'close_ticket', description: 'Close a ticket', inputSchema: { id: z.string() } })(CloseTicket);

class ReopenTicket extends ToolContext {
  async execute() {
    throw new Error('ticket store unreachable');
  }
}
Tool({ name: 'reopen_ticket', description: 'Reopen a ticket', inputSchema: { id: z.string() } })(ReopenTicket);

class HelpDesk {}
App({ id: 'help-desk', name: 'Help Desk', tools: [CloseTicket, ReopenTicket] })(HelpDesk);

const logs = [];
const handler = await FrontMcpInstance.createFetchHandler({
  info: { name: 'help-desk', version: '1.0.0' },
  apps: [HelpDesk],
  logging: { level: LogLevel.Off },
  observability: { tracing: true, logging: false, requestLogs: { onRequestComplete: (log) => logs.push(log) } },
});

async function call(name) {
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': 'tools/call',
        'mcp-name': name,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: { id: 'T-1' }, _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } },
      }),
    }),
  );
  const { result } = await response.json();
  return { errorId: result?._meta?.errorId, text: result?.content?.[0]?.text };
}

/** The exception events the spans of one tool call recorded. */
function exceptionsOf(name) {
  return exporter
    .getFinishedSpans()
    .filter((span) => JSON.stringify(span.attributes).includes(name))
    .flatMap((span) => span.events.filter((event) => event.name === 'exception'))
    .map((event) => ({
      message: event.attributes?.['exception.message'],
      stack: String(event.attributes?.['exception.stacktrace'] ?? '').split('\n')[0],
    }));
}

const client = { close: await call('close_ticket'), reopen: await call('reopen_ticket') };
await new Promise((resolve) => setTimeout(resolve, 50));

await writeFile(
  process.env.RESULT_FILE,
  JSON.stringify({
    client,
    requestLogs: logs.map((log) => log.error),
    exceptions: { close: exceptionsOf('close_ticket') },
  }),
);
process.exit(0);

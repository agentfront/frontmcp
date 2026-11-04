import type { IncomingMessage, ServerResponse } from 'node:http';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';

interface MockInvoice {
  id: string;
  status: 'open' | 'refunded' | 'void';
  amount: number;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
}

export interface MockBillingApi {
  /** The address the bundle's billing service points to. */
  readonly url: string;
  /** Every request received since the last reset, rejected ones included. */
  readonly requests: readonly RecordedRequest[];
  reset(): void;
  stop(): Promise<void>;
}

export interface MockBillingApiOptions {
  /** The only bearer credential the API accepts. */
  bearerToken: string;
  tls: { key: string; cert: string };
}

/** How long the revenue report takes, longer than the operation's `timeoutMs`. */
export const SLOW_REPORT_DELAY_MS = 2_000;

/** How many events an invoice's history holds, more than the operation's `maxResponseBytes` lets through. */
const INVOICE_EVENT_COUNT = 200;

const JSON_MEDIA_TYPE = /^\s*application\/json\s*(;|$)/i;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, status: number, body?: unknown): void {
  res.statusCode = status;
  if (body === undefined) {
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function parseJsonBody(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = raw.length > 0 ? JSON.parse(raw) : {};
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The billing API the e2e bundle describes, over HTTPS on loopback: it answers only the configured bearer credential. */
export async function startMockBillingApi(options: MockBillingApiOptions): Promise<MockBillingApi> {
  const invoices = new Map<string, MockInvoice>();
  const requests: RecordedRequest[] = [];
  let invoiceSequence = 1;
  let refundSequence = 1;

  async function route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const method = req.method ?? 'GET';
    const invoiceId = path.match(/^\/v1\/invoices\/([^/]+)/)?.[1];
    const invoice = invoiceId ? invoices.get(invoiceId) : undefined;

    if (method === 'POST' && path === '/v1/invoices') {
      const body = parseJsonBody(await readBody(req));
      if (!body) return reply(res, 400, { error: 'invalid json body' });
      const id = `inv_${invoiceSequence++}`;
      invoices.set(id, { id, status: 'open', amount: Number(body['amount'] ?? 0) });
      return reply(res, 201, { id, status: 'open' });
    }

    if (invoiceId && path === `/v1/invoices/${invoiceId}`) {
      if (!invoice) return reply(res, 404, { error: 'invoice not found' });
      if (method === 'GET') return reply(res, 200, { id: invoice.id, status: invoice.status, amount: invoice.amount });
      if (method === 'DELETE') {
        invoice.status = 'void';
        return reply(res, 204);
      }
    }

    if (method === 'GET' && invoiceId && path === `/v1/invoices/${invoiceId}/events`) {
      const events = Array.from({ length: INVOICE_EVENT_COUNT }, (_, index) => ({
        sequence: index,
        type: 'viewed',
        invoiceId,
      }));
      return reply(res, 200, { events });
    }

    if (method === 'POST' && invoiceId && path === `/v1/invoices/${invoiceId}/refunds`) {
      const body = parseJsonBody(await readBody(req));
      const amount = body?.['amount'];
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return reply(res, 400, { error: 'invalid amount' });
      }
      if (!invoice) return reply(res, 404, { error: 'invoice not found' });
      if (invoice.status !== 'open') return reply(res, 409, { error: `invoice is ${invoice.status}` });
      invoice.status = 'refunded';
      return reply(res, 201, { refundId: `rfnd_${refundSequence++}`, invoiceId: invoice.id });
    }

    if (method === 'GET' && path === '/v1/reports/revenue') {
      const timer = setTimeout(() => reply(res, 200, { total: 1234, currency: 'USD' }), SLOW_REPORT_DELAY_MS);
      res.on('close', () => clearTimeout(timer));
      return;
    }

    if (method === 'GET' && path === '/v1/account/balance') {
      return reply(res, 200, { balance: '12.50', currency: 'USD' });
    }

    if (method === 'GET' && path === '/v1/reports/usage') return reply(res, 200, { calls: 42 });
    if (method === 'GET' && path === '/v1/admin/ping') return reply(res, 200, { ok: true });

    reply(res, 404, { error: 'no route', method, path });
  }

  const server = https.createServer(options.tls, (req, res) => {
    const path = new URL(req.url ?? '/', 'https://localhost').pathname;
    const authorization = req.headers['authorization'];
    requests.push({ method: req.method ?? 'GET', path, authorization });

    if (authorization !== `Bearer ${options.bearerToken}`) {
      return reply(res, 401, { error: 'invalid bearer token' });
    }
    // A JSON body sent as text/plain (the #690 regression) must fail, not parse anyway.
    if (req.method === 'POST' && !JSON_MEDIA_TYPE.test(req.headers['content-type'] ?? '')) {
      return reply(res, 415, { error: 'expected an application/json body' });
    }
    route(req, res, path).catch((error: unknown) => {
      reply(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;

  return {
    url: `https://localhost:${port}`,
    requests,
    reset() {
      invoices.clear();
      requests.length = 0;
      invoiceSequence = 1;
      refundSequence = 1;
    },
    stop() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// file: apps/demo/src/skilled-openapi-fixtures/mock-rest-server.ts
//
// Tiny http server that answers the three billing operations declared by
// `billing-bundle.json`. Run alongside the FrontMCP demo to verify the full
// skilled-openapi flow end-to-end.

import * as http from 'node:http';

interface MockInvoice {
  id: string;
  status: 'open' | 'refunded';
  amount: number;
  customerId: string;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function reply(res: http.ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function startMockBillingServer(port = 9876): Promise<http.Server> {
  const invoices = new Map<string, MockInvoice>();
  let invoiceSeq = 1;
  let refundSeq = 1;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const auth = req.headers['authorization'];
      if (!auth || Array.isArray(auth) || !auth.startsWith('Bearer ')) {
        return reply(res, 401, { error: 'missing bearer token' });
      }

      // POST /v1/invoices
      if (req.method === 'POST' && url.pathname === '/v1/invoices') {
        let body: { amount?: unknown; customerId?: unknown };
        try {
          body = JSON.parse((await readBody(req)) || '{}');
        } catch {
          return reply(res, 400, { error: 'invalid JSON' });
        }
        if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
          return reply(res, 400, { error: 'amount must be a finite number > 0' });
        }
        if (typeof body.customerId !== 'string' || body.customerId.length === 0) {
          return reply(res, 400, { error: 'customerId must be a non-empty string' });
        }
        const id = `inv_${invoiceSeq++}`;
        invoices.set(id, {
          id,
          status: 'open',
          amount: body.amount,
          customerId: body.customerId,
        });
        return reply(res, 201, { id, status: 'open' });
      }

      // GET /v1/invoices/{id}
      const getMatch = url.pathname.match(/^\/v1\/invoices\/([^/]+)$/);
      if (req.method === 'GET' && getMatch) {
        const id = getMatch[1]!;
        const inv = invoices.get(id);
        if (!inv) return reply(res, 404, { error: 'not found' });
        return reply(res, 200, { id: inv.id, status: inv.status, amount: inv.amount });
      }

      // POST /v1/invoices/{id}/refunds
      const refundMatch = url.pathname.match(/^\/v1\/invoices\/([^/]+)\/refunds$/);
      if (req.method === 'POST' && refundMatch) {
        const id = refundMatch[1]!;
        const inv = invoices.get(id);
        if (!inv) return reply(res, 404, { error: 'not found' });
        if (inv.status === 'refunded') return reply(res, 409, { error: 'already refunded' });
        inv.status = 'refunded';
        return reply(res, 201, { refundId: `rfnd_${refundSeq++}`, invoiceId: id });
      }

      reply(res, 404, { error: 'no route', method: req.method, path: url.pathname });
    } catch (e) {
      reply(res, 500, { error: (e as Error).message });
    }
  });

  // Wait for the socket to actually bind so callers can't race the first
  // request, and so EADDRINUSE surfaces as a rejected promise instead of an
  // uncaught error event.
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('error', onError);
      reject(error);
    };
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      console.log(`[mock-billing] listening on http://localhost:${port}`);
      resolve();
    });
  });

  return server;
}

if (require.main === module) {
  void startMockBillingServer(Number(process.env['MOCK_BILLING_PORT'] ?? 9876)).catch((e: unknown) => {
    console.error('[mock-billing] failed to start:', (e as Error).message);
    process.exit(1);
  });
}

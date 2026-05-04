// file: apps/e2e/demo-e2e-skilled-openapi/src/mock-rest-server.ts

import * as http from 'node:http';

interface MockInvoice {
  id: string;
  status: 'open' | 'refunded';
  amount: number;
  customerId: string;
}

const invoices = new Map<string, MockInvoice>();
let invoiceSeq = 1;
let refundSeq = 1;

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
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const auth = req.headers['authorization'];
      if (!auth || Array.isArray(auth) || !auth.startsWith('Bearer ')) {
        return reply(res, 401, { error: 'missing bearer token' });
      }

      if (req.method === 'POST' && url.pathname === '/v1/invoices') {
        const body = JSON.parse((await readBody(req)) || '{}');
        const id = `inv_${invoiceSeq++}`;
        invoices.set(id, {
          id,
          status: 'open',
          amount: Number(body.amount ?? 0),
          customerId: String(body.customerId ?? ''),
        });
        return reply(res, 201, { id, status: 'open' });
      }

      const getMatch = url.pathname.match(/^\/v1\/invoices\/([^/]+)$/);
      if (req.method === 'GET' && getMatch) {
        const id = getMatch[1]!;
        const inv = invoices.get(id);
        if (!inv) return reply(res, 404, { error: 'not found' });
        // Return ONLY the fields declared in the bundle's outputSchema for
        // getInvoice ({ id, status, amount }). Extras like `customerId` would
        // be rejected by the new `additionalProperties: false` constraint.
        return reply(res, 200, { id: inv.id, status: inv.status, amount: inv.amount });
      }

      const refundMatch = url.pathname.match(/^\/v1\/invoices\/([^/]+)\/refunds$/);
      if (req.method === 'POST' && refundMatch) {
        // Validate the refund body so a regression in execute_action's body
        // mapper (e.g. dropping the `amount` parameter) actually fails the
        // e2e suite rather than silently passing.
        const raw = await readBody(req);
        let body: { amount?: unknown };
        try {
          body = raw.length > 0 ? (JSON.parse(raw) as { amount?: unknown }) : {};
        } catch {
          return reply(res, 400, { error: 'invalid json body' });
        }
        if (typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
          return reply(res, 400, { error: 'invalid amount' });
        }
        const id = refundMatch[1]!;
        const inv = invoices.get(id);
        if (!inv) return reply(res, 404, { error: 'not found' });
        if (inv.status === 'refunded') return reply(res, 409, { error: 'already refunded' });
        inv.status = 'refunded';
        return reply(res, 201, { refundId: `rfnd_${refundSeq++}`, invoiceId: id });
      }

      if (req.method === 'GET' && url.pathname === '/v1/admin/ping') {
        return reply(res, 200, { ok: true });
      }

      reply(res, 404, { error: 'no route', method: req.method, path: url.pathname });
    } catch (e) {
      reply(res, 500, { error: (e as Error).message });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return server;
}

import type { ResolvedBundle } from '@frontmcp/adapters/skills';

import { BILLING_API_URL, BUNDLE_URL, JWKS_URL } from './managed-bundles';

const DNS_OVER_HTTPS_URL = 'https://cloudflare-dns.com/dns-query';
const DNS_TYPE_A = 1;
const PUBLIC_BILLING_API_ADDRESS = '93.184.215.14';

export interface OutboundRequest {
  method: string;
  url: string;
  authorization: string | null;
  body: string;
}

interface ManagedInternetOptions {
  jwks: unknown;
  pullToken: string;
  billingToken: string;
}

/** The https hosts the Worker reaches, answered in the test process: the bundle server and the billing API. */
export class ManagedInternet {
  /** What the JWKS URL serves. */
  jwks: unknown;
  /** What the bundle URL serves to a request carrying the pull token. */
  bundle?: ResolvedBundle;
  readonly requests: OutboundRequest[] = [];

  constructor(private readonly options: ManagedInternetOptions) {
    this.jwks = options.jwks;
  }

  requestsTo(url: string): OutboundRequest[] {
    return this.requests.filter((request) => request.url === url);
  }

  readonly fetch = async (request: Request): Promise<Response> => {
    const recorded: OutboundRequest = {
      method: request.method,
      url: request.url,
      authorization: request.headers.get('authorization'),
      body: await request.text(),
    };
    this.requests.push(recorded);
    return this.answer(recorded);
  };

  private answer({ method, url, authorization, body }: OutboundRequest): Response {
    if (method === 'GET' && url.startsWith(`${DNS_OVER_HTTPS_URL}?`)) return resolveBillingHost(new URL(url));
    if (method === 'GET' && url === JWKS_URL) return Response.json(this.jwks);
    if (method === 'GET' && url === BUNDLE_URL) {
      if (authorization !== `Bearer ${this.options.pullToken}`) return new Response('unauthorized', { status: 401 });
      return this.bundle ? Response.json(this.bundle) : new Response('no bundle published', { status: 404 });
    }
    if (method === 'POST' && url === `${BILLING_API_URL}/v1/invoices`) {
      if (authorization !== `Bearer ${this.options.billingToken}`) return new Response('unauthorized', { status: 401 });
      const invoice = JSON.parse(body) as { customerId: string; amount: number };
      return Response.json({ id: `inv_${invoice.customerId}`, status: 'open' }, { status: 201 });
    }
    return new Response(`no route for ${method} ${url}`, { status: 404 });
  }
}

/** workerd's `node:dns` asks DNS over HTTPS: the billing API's host resolves to a public address, other names to none. */
function resolveBillingHost(query: URL): Response {
  const name = query.searchParams.get('name');
  const isBillingHostA = name === new URL(BILLING_API_URL).hostname && query.searchParams.get('type') === 'A';
  const answer = isBillingHostA ? [{ name, type: DNS_TYPE_A, TTL: 300, data: PUBLIC_BILLING_API_ADDRESS }] : [];
  return Response.json({ Status: 0, Question: [{ name, type: query.searchParams.get('type') }], Answer: answer });
}

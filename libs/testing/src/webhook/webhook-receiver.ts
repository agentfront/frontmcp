/**
 * A local webhook receiver for tests of MCP Events: it answers the verification challenge, checks Standard Webhooks
 * signatures, records every request, and can be told to fail.
 *
 * @example
 * ```typescript
 * const receiver = new WebhookReceiver({ secrets: [secret] });
 * const { url } = await receiver.start();
 * // subscribe with `delivery: { url, secret }`, publish, then:
 * const [delivery] = await receiver.waitForDeliveries(1);
 * expect(delivery.signatureCheck).toBe('valid');
 * await receiver.stop();
 * ```
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { type AddressInfo } from 'net';

import { signingKeyOf, verifyWebhookSignature, type WebhookSignatureCheck } from '@frontmcp/utils';

const WELL_KNOWN_PATH = '/.well-known/mcp-webhook-receiver.json';
const SUBSCRIPTION_ID_HEADER = 'x-mcp-subscription-id';
const POLL_INTERVAL_MS = 20;

export interface WebhookReceiverOptions {
  /** The secrets deliveries are signed with. A request none of them signed is answered 401. Without any, nothing is checked. */
  secrets?: string[];
  /** The path prefixes the well-known document declares. Without any, the document is a 404 and the challenge is used. */
  receivers?: string[];
  /** The path deliveries are sent to. @default '/hooks/mcp' */
  path?: string;
  /** @default an ephemeral port */
  port?: number;
}

export interface WebhookReceiverInfo {
  /** The callback URL to subscribe with. */
  url: string;
  origin: string;
  port: number;
}

export type ReceivedWebhookKind = 'verification' | 'gap' | 'terminated' | 'event';

export interface ReceivedWebhook {
  kind: ReceivedWebhookKind;
  path: string;
  /** The body exactly as it arrived: the bytes the signature covers. */
  body: string;
  /** The body as JSON, or undefined when it is not JSON. */
  json: Record<string, unknown> | undefined;
  webhookId?: string;
  webhookTimestamp?: string;
  webhookSignature?: string;
  subscriptionId?: string;
  /** `unchecked` when the receiver has no secret. */
  signatureCheck: WebhookSignatureCheck | 'unchecked';
  /** The status the receiver answered with. */
  answeredStatus: number;
  receivedAt: number;
}

/** The header of a request as one string. */
function headerOf(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The JSON object a body holds, when it holds one. */
function jsonObjectOf(body: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** What a webhook body is: a control envelope named by its `type`, or an event. */
function kindOf(json: Record<string, unknown> | undefined): ReceivedWebhookKind {
  const type = json?.['type'];
  return type === 'verification' || type === 'gap' || type === 'terminated' ? type : 'event';
}

/** Reads a request body as UTF-8 text. */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

/** An HTTP server on 127.0.0.1 that stands in for the callback of a webhook subscription. */
export class WebhookReceiver {
  private readonly options: WebhookReceiverOptions;
  private readonly secrets: string[];
  private readonly received: ReceivedWebhook[] = [];
  private server: Server | undefined;
  private info: WebhookReceiverInfo | undefined;
  private failuresLeft = 0;
  private failureStatus = 500;
  private echoesChallenges = true;

  /** Takes the secrets to verify with, the well-known prefixes to declare, and the path and port to listen on. */
  constructor(options: WebhookReceiverOptions = {}) {
    this.options = options;
    this.secrets = [...(options.secrets ?? [])];
  }

  /** Listen on 127.0.0.1 and answer with the callback URL. */
  async start(): Promise<WebhookReceiverInfo> {
    const server = createServer((request, response) => {
      this.handle(request, response).catch(() => response.destroy());
    });
    await new Promise<void>((resolve) => server.listen(this.options.port ?? 0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const origin = `http://127.0.0.1:${port}`;
    this.server = server;
    this.info = { url: `${origin}${this.options.path ?? '/hooks/mcp'}`, origin, port };
    return this.info;
  }

  /** Stop listening. */
  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.info = undefined;
    if (server) await new Promise((resolve) => server.close(resolve));
  }

  /** The callback URL; the receiver must be started. */
  get url(): string {
    if (!this.info) throw new Error('WebhookReceiver is not started: call start() first');
    return this.info.url;
  }

  /** Every request received, oldest first. */
  get requests(): readonly ReceivedWebhook[] {
    return this.received;
  }

  /** The verification challenges received. */
  verifications(): ReceivedWebhook[] {
    return this.received.filter((request) => request.kind === 'verification');
  }

  /** The event deliveries received, retries included. */
  deliveries(): ReceivedWebhook[] {
    return this.received.filter((request) => request.kind === 'event');
  }

  /** Forget the requests received so far. */
  clear(): void {
    this.received.length = 0;
  }

  /** Accept deliveries signed with one more secret, as after a rotation. */
  addSecret(secret: string): void {
    this.secrets.push(secret);
  }

  /** Answer the next `count` deliveries with `status` instead of 200. Verification challenges are not affected. */
  failNext(count: number, status = 500): void {
    this.failuresLeft = count;
    this.failureStatus = status;
  }

  /** Whether a verification challenge is echoed (the default) or answered with an empty object. */
  echoChallenges(echo: boolean): void {
    this.echoesChallenges = echo;
  }

  /** Resolve once `count` event deliveries arrived, retries included; reject after `timeoutMs`. */
  async waitForDeliveries(count: number, timeoutMs = 5000): Promise<ReceivedWebhook[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.deliveries().length < count) {
      if (Date.now() > deadline) {
        throw new Error(
          `WebhookReceiver: ${this.deliveries().length} of ${count} deliveries arrived in ${timeoutMs} ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return this.deliveries();
  }

  /** Answer one request: the well-known document, or a webhook that is checked, recorded and answered. */
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === WELL_KNOWN_PATH) {
      this.answerWellKnown(response);
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }

    const body = await readBody(request);
    const json = jsonObjectOf(body);
    const kind = kindOf(json);
    const signatureCheck = this.checkSignature(request, body);
    const answeredStatus = this.statusFor(kind, signatureCheck);
    this.received.push({
      kind,
      path,
      body,
      json,
      webhookId: headerOf(request, 'webhook-id'),
      webhookTimestamp: headerOf(request, 'webhook-timestamp'),
      webhookSignature: headerOf(request, 'webhook-signature'),
      subscriptionId: headerOf(request, SUBSCRIPTION_ID_HEADER),
      signatureCheck,
      answeredStatus,
      receivedAt: Date.now(),
    });

    const echoed = kind === 'verification' && this.echoesChallenges ? { challenge: json?.['challenge'] } : {};
    response.writeHead(answeredStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answeredStatus === 200 ? echoed : {}));
  }

  /** Serve the well-known document when the receiver declares path prefixes. */
  private answerWellKnown(response: ServerResponse): void {
    const { receivers } = this.options;
    if (!receivers) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ receivers }));
  }

  /** Check the Standard Webhooks signature of a request against the receiver's secrets. */
  private checkSignature(request: IncomingMessage, body: string): WebhookSignatureCheck | 'unchecked' {
    if (this.secrets.length === 0) return 'unchecked';
    return verifyWebhookSignature(
      {
        id: headerOf(request, 'webhook-id'),
        timestamp: headerOf(request, 'webhook-timestamp'),
        signature: headerOf(request, 'webhook-signature'),
        body,
      },
      this.secrets.map(signingKeyOf),
    );
  }

  /** The status a webhook is answered with: 401 for a bad signature, a pending failure for a delivery, else 200. */
  private statusFor(kind: ReceivedWebhookKind, signatureCheck: WebhookSignatureCheck | 'unchecked'): number {
    if (signatureCheck !== 'valid' && signatureCheck !== 'unchecked') return 401;
    if (kind === 'verification' || this.failuresLeft === 0) return 200;
    this.failuresLeft -= 1;
    return this.failureStatus;
  }
}

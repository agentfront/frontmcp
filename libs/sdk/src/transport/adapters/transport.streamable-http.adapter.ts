import { TransportType } from '../transport.types';
import { AuthenticatedServerRequest } from '../../server/server.types';
import { LocalTransportAdapter } from './transport.local.adapter';
import { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodType } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { rpcRequest } from '../transport.error';
import { ServerResponse } from '../../common';
import { RecreateableStreamableHTTPServerTransport } from './streamable-http-transport';
import { ElicitResult, ElicitOptions, DEFAULT_ELICIT_TTL } from '../../elicitation';
import { ElicitationTimeoutError, InvalidInputError } from '../../errors';

/**
 * Stateless HTTP requests must be able to send multiple initialize calls without
 * tripping the MCP transport's "already initialized" guard. The upstream SDK
 * treats any transport with a session ID generator as stateful, so we disable
 * session generation entirely for stateless transports.
 */
export const resolveSessionIdGenerator = (
  transportType: TransportType,
  sessionId: string,
): (() => string) | undefined => {
  return transportType === 'stateless-http' ? undefined : () => sessionId;
};

export class TransportStreamableHttpAdapter extends LocalTransportAdapter<RecreateableStreamableHTTPServerTransport> {
  override createTransport(sessionId: string, response: ServerResponse): RecreateableStreamableHTTPServerTransport {
    const sessionIdGenerator = resolveSessionIdGenerator(this.key.type, sessionId);

    return new RecreateableStreamableHTTPServerTransport({
      sessionIdGenerator,
      onsessionclosed: () => {
        // Note: We don't call this.destroy() here because the adapter
        // lifecycle is managed by the transport registry, not session events.
      },
      onsessioninitialized: (sessionId) => {
        if (sessionId) {
          console.log(`session initialized: ${sessionId.slice(0, 40)}`);
        } else {
          console.log(`stateless session initialized`);
        }
      },
      // Disable eventStore to prevent priming events - Claude.ai's client doesn't handle them
      // The priming event has empty data with no `event:` type, which violates MCP spec
      // ("Event types MUST be message") and confuses some clients
      eventStore: undefined,
    });
  }

  async initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.ensureAuthInfo(req, this);

    this.logger.info('[StreamableHttpAdapter] initialize() called', {
      method: req.method,
      sessionId: this.key.sessionId.slice(0, 30),
      bodyMethod: (req.body as { method?: string })?.method,
      bodyJsonrpc: (req.body as { jsonrpc?: string })?.jsonrpc,
      bodyId: (req.body as { id?: number })?.id,
      bodyType: typeof req.body,
      bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
    });

    // Wait for server connection to complete before handling request
    await this.ready;

    // Debug: log transport state
    this.logger.info('[StreamableHttpAdapter] transport state before handleRequest', {
      isRecreatable: this.transport instanceof RecreateableStreamableHTTPServerTransport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hasWebTransport: !!(this.transport as any)._webStandardTransport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      webTransportInitialized: (this.transport as any)._webStandardTransport?._initialized,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      webTransportStarted: (this.transport as any)._webStandardTransport?._started,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hasSessionIdGenerator: (this.transport as any)._webStandardTransport?.sessionIdGenerator !== undefined,
    });

    // Intercept response to log what gets sent back to client
    const originalWrite = res.write.bind(res) as typeof res.write;
    const originalEnd = res.end.bind(res) as typeof res.end;
    let responseBody = '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.write = function (this: ServerResponse, chunk: any, encodingOrCb?: any, cb?: any): boolean {
      if (chunk) {
        responseBody += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      }
      return originalWrite.call(this, chunk, encodingOrCb, cb);
    } as typeof res.write;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const adapter = this;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.end = function (this: ServerResponse, chunk?: any, encodingOrCb?: any, cb?: any): ServerResponse {
      if (chunk) {
        responseBody += typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      }
      adapter.logger.verbose('[StreamableHttpAdapter] initialize response', {
        statusCode: res.statusCode,
        headers: res.getHeaders?.() ?? {},
        bodyLength: responseBody.length,
      });
      return originalEnd.call(this, chunk, encodingOrCb, cb);
    } as typeof res.end;

    return this.transport.handleRequest(req, res, req.body);
  }

  async handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.ensureAuthInfo(req, this);
    //
    // if ((await this.isInitialized) && isInitializeRequest(req.body)) {
    //   await this.transport.close();
    //   this.isInitialized = this.connectStreamableTransport(req.authSession.session!.id);
    //   await this.ready;
    // }

    if (req.method === 'GET') {
      return this.transport.handleRequest(req, res);
    } else {
      if (this.handleIfElicitResult(req)) {
        return;
      }
      return this.transport.handleRequest(req, res, req.body);
    }
  }

  /**
   * Send an elicitation request to the client.
   *
   * Only one elicit per session is allowed. A new elicit will cancel any pending one.
   * On timeout, an ElicitationTimeoutError is thrown to kill tool execution.
   *
   * In distributed mode, the pending elicitation is stored in Redis and results
   * are routed via pub/sub, allowing the response to be received by any node.
   *
   * @param relatedRequestId - The request ID that triggered this elicit
   * @param message - Message to display to the user
   * @param requestedSchema - Zod schema for the expected response
   * @param options - Elicit options (mode, ttl, elicitationId)
   * @returns ElicitResult with status and typed content
   */
  async sendElicitRequest<S extends ZodType>(
    relatedRequestId: RequestId,
    message: string,
    requestedSchema: S,
    options?: ElicitOptions,
  ): Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>> {
    const { mode = 'form', ttl = DEFAULT_ELICIT_TTL, elicitationId } = options ?? {};

    // URL mode requires elicitationId for out-of-band tracking
    if (mode === 'url' && !elicitationId) {
      throw new InvalidInputError('elicitationId is required when mode is "url"');
    }

    // Cancel any previous pending elicit (only one per session)
    await this.cancelPendingElicit();

    // Generate elicit ID
    const elicitId = elicitationId ?? `elicit-${this.newRequestId}`;
    const sessionId = this.key.sessionId;
    const expiresAt = Date.now() + ttl;

    // Store pending elicitation in the store (for distributed mode)
    await this.elicitStore.setPending({
      elicitId,
      sessionId,
      createdAt: Date.now(),
      expiresAt,
      message,
      mode,
    });

    // Build request params based on mode
    const params: Record<string, unknown> = {
      mode,
      message,
      requestedSchema: toJSONSchema(requestedSchema as ZodType),
    };

    // Add elicitationId for URL mode (required for out-of-band tracking)
    if (mode === 'url' && elicitationId) {
      params['elicitationId'] = elicitationId;
    }

    // Send the elicitation/create request
    this.logger.info('[StreamableHttpAdapter] sendElicitRequest: sending elicitation/create', {
      relatedRequestId,
      elicitId,
      mode,
      message: message.slice(0, 100),
    });
    try {
      await this.transport.send(rpcRequest(this.newRequestId, 'elicitation/create', params), { relatedRequestId });
      this.logger.info('[StreamableHttpAdapter] sendElicitRequest: transport.send() completed');
    } catch (error) {
      this.logger.error('[StreamableHttpAdapter] sendElicitRequest: transport.send() failed', error);
      throw error;
    }

    // Create promise with timeout and store subscription
    // Uses settlement guard to prevent double resolution from concurrent paths
    return new Promise<ElicitResult<S extends ZodType<infer O> ? O : unknown>>((resolve, reject) => {
      let settled = false;
      let unsubscribe: (() => Promise<void>) | undefined;

      const cleanup = () => {
        clearTimeout(timeoutHandle);
        this.pendingElicit = undefined;
        void unsubscribe?.();
      };

      const safeResolve = (result: ElicitResult<unknown>) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result as ElicitResult<S extends ZodType<infer O> ? O : unknown>);
      };

      const safeReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      // Set timeout to throw ElicitationTimeoutError (kills execution)
      const timeoutHandle = setTimeout(async () => {
        if (settled) return;
        settled = true;
        this.pendingElicit = undefined;
        await unsubscribe?.();
        await this.elicitStore.deletePending(sessionId);
        reject(new ElicitationTimeoutError(elicitId, ttl));
      }, ttl);

      // Subscribe to results via the store (for distributed mode)
      this.elicitStore
        .subscribeResult<S extends ZodType<infer O> ? O : unknown>(elicitId, (result) => {
          safeResolve(result);
        })
        .then((unsub) => {
          unsubscribe = unsub;
        })
        .catch(async (err) => {
          // Fail fast on subscription error instead of waiting for timeout
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          this.pendingElicit = undefined;
          await unsubscribe?.();
          await this.elicitStore.deletePending(sessionId);
          reject(err);
        });

      // Also store local pending elicit (for single-node mode and error handling)
      this.pendingElicit = {
        elicitId,
        timeoutHandle,
        resolve: safeResolve,
        reject: safeReject,
      };
    });
  }

  /**
   * Marks this transport as pre-initialized for session recreation.
   * This is needed when recreating a transport from Redis because the
   * original initialize request was processed by a different transport instance.
   *
   * Uses the RecreateableStreamableHTTPServerTransport's public API to set
   * initialization state, avoiding access to private properties.
   */
  override markAsInitialized(): void {
    this.transport.setInitializationState(this.key.sessionId);
    this.logger.info('[StreamableHttpAdapter] Marked transport as pre-initialized for session recreation', {
      sessionId: this.key.sessionId?.slice(0, 20),
      isInitialized: this.transport.isInitialized,
    });
  }
}

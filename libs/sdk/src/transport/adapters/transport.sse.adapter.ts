import { AuthenticatedServerRequest } from '../../server/server.types';
import { RecreateableSSEServerTransport } from './sse-transport';
import { LocalTransportAdapter } from './transport.local.adapter';
import { RequestId } from '@modelcontextprotocol/sdk/types.js';
import { ZodType } from 'zod';
import { toJSONSchema } from 'zod/v4';
import { rpcRequest } from '../transport.error';
import { ServerResponse } from '../../common';
import { ElicitResult, ElicitOptions, DEFAULT_ELICIT_TTL } from '../../elicitation';
import { ElicitationTimeoutError, InvalidInputError } from '../../errors';

export class TransportSSEAdapter extends LocalTransportAdapter<RecreateableSSEServerTransport> {
  sessionId: string;

  /**
   * Configures common error and close handlers for SSE transports.
   */
  private configureTransportHandlers(transport: RecreateableSSEServerTransport): void {
    transport.onerror = (error) => {
      // Use safe logging to avoid Node.js 24 util.inspect bug with Zod errors
      console.error('SSE error:', error instanceof Error ? error.message : 'Unknown error');
    };
    transport.onclose = this.destroy.bind(this);
  }

  override createTransport(sessionId: string, res: ServerResponse): RecreateableSSEServerTransport {
    this.sessionId = sessionId;
    this.logger.info(`new transport session: ${sessionId.slice(0, 40)}`);
    const transport = new RecreateableSSEServerTransport(`${this.scope.fullPath}/message`, res, {
      sessionId: sessionId,
    });
    this.configureTransportHandlers(transport);
    return transport;
  }

  /**
   * Recreates a transport with preserved session state.
   * Use this when restoring a session from Redis or other storage.
   *
   * @param sessionId - The session ID to restore
   * @param res - The new response stream for SSE
   * @param lastEventId - The last event ID that was sent (for reconnection support)
   */
  createTransportFromSession(
    sessionId: string,
    res: ServerResponse,
    lastEventId?: number,
  ): RecreateableSSEServerTransport {
    this.sessionId = sessionId;
    this.logger.info(`recreating transport session: ${sessionId.slice(0, 40)}, lastEventId: ${lastEventId ?? 'none'}`);
    const transport = new RecreateableSSEServerTransport(`${this.scope.fullPath}/message`, res, {
      sessionId: sessionId,
      initialEventId: lastEventId,
    });
    this.configureTransportHandlers(transport);
    return transport;
  }

  initialize(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    this.logger.verbose(`[${this.sessionId}] handle initialize request`);
    this.ensureAuthInfo(req, this);
    return Promise.resolve();
  }

  async handleRequest(req: AuthenticatedServerRequest, res: ServerResponse): Promise<void> {
    // Wait for server connection to complete before handling request
    await this.ready;

    const authInfo = this.ensureAuthInfo(req, this);

    if (this.handleIfElicitResult(req)) {
      this.logger.verbose(`[${this.sessionId}] handled elicitation result`);
      // Send HTTP 202 Accepted response for elicitation results
      // The elicitation result is processed asynchronously, so we acknowledge receipt
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, result: {} }));
      return;
    }
    if (req.method === 'GET') {
      this.logger.verbose(`[${this.sessionId}] handle get request`);
      return this.transport.handleMessage(req.body, { requestInfo: req, authInfo });
    } else {
      this.logger.verbose(`[${this.sessionId}] handle post request`);
      return this.transport.handlePostMessage(req, res, req.body);
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

    // Add elicitationId for URL mode
    if (mode === 'url' && elicitationId) {
      params['elicitationId'] = elicitationId;
    }

    this.logger.info('sendElicitRequest', { relatedRequestId, elicitId, mode, ttl });

    // Send the elicitation/create request
    await this.transport.send(rpcRequest(this.newRequestId, 'elicitation/create', params));

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
      // Pass sessionId for encrypted stores to enable decryption
      this.elicitStore
        .subscribeResult<S extends ZodType<infer O> ? O : unknown>(
          elicitId,
          (result) => {
            safeResolve(result);
          },
          sessionId,
        )
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
}

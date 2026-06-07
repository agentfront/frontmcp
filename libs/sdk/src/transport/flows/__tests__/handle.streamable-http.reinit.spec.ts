/**
 * Tests for the idempotent re-initialization reset helper used by the
 * streamable HTTP `onInitialize` stage.
 *
 * Regression coverage for #474: an `initialize` request on a live, already
 * initialized transport must be reset in place (so a fresh handshake is
 * accepted under the same session id) instead of dead-ending on the MCP SDK's
 * `-32600 "Server already initialized"`. The reset previously only ran when the
 * router had set the `reinitialize` flag (i.e. after an explicit in-process
 * DELETE), so dev-restart / reconnect / retry re-inits silently fell through to
 * the SDK and 400'd.
 */

import {
  buildReinitFailedResponse,
  resetInitializedTransportForReinit,
  type ReinitializableTransport,
} from '../handle.streamable-http.flow';

describe('resetInitializedTransportForReinit (#474)', () => {
  /**
   * Fake transport whose `isInitialized` flips to `false` once
   * `resetForReinitialization()` runs — mirroring a healthy MCP SDK transport.
   */
  function createTransport(opts: {
    initialized: boolean;
    /** When true, the reset does NOT clear the initialized flag (stuck transport). */
    resetIneffective?: boolean;
  }): ReinitializableTransport & {
    resetForReinitialization: jest.Mock;
    reregisterServer: jest.Mock;
  } {
    let initialized = opts.initialized;
    const resetForReinitialization = jest.fn(() => {
      if (!opts.resetIneffective) {
        initialized = false;
      }
    });
    const reregisterServer = jest.fn();
    return {
      get isInitialized() {
        return initialized;
      },
      resetForReinitialization,
      reregisterServer,
    };
  }

  it('returns true without touching the transport when it is not initialized', () => {
    const transport = createTransport({ initialized: false });

    const ok = resetInitializedTransportForReinit(transport);

    expect(ok).toBe(true);
    expect(transport.resetForReinitialization).not.toHaveBeenCalled();
    expect(transport.reregisterServer).not.toHaveBeenCalled();
  });

  it('resets and re-registers an initialized transport, returning true on success', () => {
    const transport = createTransport({ initialized: true });

    const ok = resetInitializedTransportForReinit(transport);

    expect(ok).toBe(true);
    expect(transport.resetForReinitialization).toHaveBeenCalledTimes(1);
    expect(transport.reregisterServer).toHaveBeenCalledTimes(1);
    expect(transport.isInitialized).toBe(false);
  });

  it('re-registers the server (restores the notification mapping a DELETE removed)', () => {
    const transport = createTransport({ initialized: true });
    const order: string[] = [];
    transport.resetForReinitialization.mockImplementation(() => order.push('reset'));
    transport.reregisterServer.mockImplementation(() => order.push('reregister'));

    resetInitializedTransportForReinit(transport);

    // reset must precede re-register so the fresh server map points at a clean transport
    expect(order).toEqual(['reset', 'reregister']);
  });

  it('returns false when the transport is STILL initialized after reset (stuck)', () => {
    const transport = createTransport({ initialized: true, resetIneffective: true });

    const ok = resetInitializedTransportForReinit(transport);

    expect(ok).toBe(false);
    expect(transport.resetForReinitialization).toHaveBeenCalledTimes(1);
    expect(transport.reregisterServer).toHaveBeenCalledTimes(1);
    // Caller uses this `false` to surface a clear error instead of a bare -32600.
    expect(transport.isInitialized).toBe(true);
  });
});

describe('buildReinitFailedResponse — clear error when reset fails (#474)', () => {
  it('returns a 400 JSON-RPC error (not the SDK -32600) with an actionable hint', () => {
    const res = buildReinitFailedResponse('sess-abc', 7);

    expect(res.kind).toBe('json');
    expect(res.status).toBe(400);
    const body = res.body as { jsonrpc: string; error: { code: number; message: string }; id: unknown };
    // -32000 (server error), NOT the bare -32600 the SDK would emit.
    expect(body.error.code).toBe(-32000);
    expect(body.error.code).not.toBe(-32600);
    // Names the session and tells the client how to recover.
    expect(body.error.message).toContain('sess-abc');
    expect(body.error.message).toMatch(/DELETE/);
    expect(body.error.message).toMatch(/mcp-session-id/);
  });

  it('echoes the JSON-RPC request id so the client can correlate the error', () => {
    expect((buildReinitFailedResponse('s', 7).body as { id: unknown }).id).toBe(7);
    expect((buildReinitFailedResponse('s', 'req-1').body as { id: unknown }).id).toBe('req-1');
    // A literal id of 0 must be preserved (nullish handling, not falsy).
    expect((buildReinitFailedResponse('s', 0).body as { id: unknown }).id).toBe(0);
  });

  it('falls back to a generated id when the request had none', () => {
    const id = (buildReinitFailedResponse('s', null).body as { id: unknown }).id;
    // Not null — httpRespond.rpcError mints an id so the envelope is always correlatable.
    expect(id).toBeTruthy();
  });
});

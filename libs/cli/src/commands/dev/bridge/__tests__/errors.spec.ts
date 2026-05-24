import { DEV_BUFFER_FULL, DEV_RELOAD_DEADLINE, DEV_SERVER_UNREACHABLE, makeDevError } from '../errors';

describe('bridge error helpers (issue #399)', () => {
  it('reserves codes in the implementation-defined range', () => {
    for (const code of [DEV_SERVER_UNREACHABLE, DEV_BUFFER_FULL, DEV_RELOAD_DEADLINE]) {
      expect(code).toBeLessThan(-32000);
      expect(code).toBeGreaterThanOrEqual(-32099);
    }
  });

  it('builds a well-formed JSON-RPC error response', () => {
    const err = makeDevError(42, DEV_SERVER_UNREACHABLE, { reason: 'reload' });
    expect(err).toMatchObject({
      jsonrpc: '2.0',
      id: 42,
      error: { code: DEV_SERVER_UNREACHABLE, message: 'dev_server_unreachable', data: { reason: 'reload' } },
    });
  });

  it('omits data when none is supplied', () => {
    const err = makeDevError(null, DEV_BUFFER_FULL);
    expect(err.error).toEqual({ code: DEV_BUFFER_FULL, message: 'dev_buffer_full' });
  });
});

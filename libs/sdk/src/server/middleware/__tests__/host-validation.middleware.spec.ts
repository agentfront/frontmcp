import type { ServerRequest, ServerResponse } from '../../../common';
import { createHostValidationMiddleware } from '../host-validation.middleware';

function createMockReq(headers: Record<string, string | undefined> = {}): ServerRequest {
  return { headers } as unknown as ServerRequest;
}

function createMockRes(): ServerResponse & { statusCode?: number; body?: unknown } {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.body = data;
      return res;
    },
  };
  return res as unknown as ServerResponse & { statusCode?: number; body?: unknown };
}

describe('createHostValidationMiddleware()', () => {
  it('returns no-op middleware when not enabled', () => {
    const middleware = createHostValidationMiddleware({ enabled: false });
    const next = jest.fn();
    middleware(createMockReq(), createMockRes() as ServerResponse, next);
    expect(next).toHaveBeenCalled();
  });

  describe('when enabled with allowedHosts', () => {
    const middleware = createHostValidationMiddleware({
      enabled: true,
      allowedHosts: ['localhost:3001', 'api.example.com'],
    });

    it('passes valid host', () => {
      const next = jest.fn();
      middleware(createMockReq({ host: 'localhost:3001' }), createMockRes() as ServerResponse, next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects invalid host with 403', () => {
      const next = jest.fn();
      const res = createMockRes();
      middleware(createMockReq({ host: 'evil.com' }), res as ServerResponse, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual(expect.objectContaining({ error: 'Forbidden' }));
    });

    it('rejects missing host with 403', () => {
      const next = jest.fn();
      const res = createMockRes();
      middleware(createMockReq({}), res as ServerResponse, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });

  describe('when enabled with allowedOrigins', () => {
    const middleware = createHostValidationMiddleware({
      enabled: true,
      allowedOrigins: ['https://app.example.com'],
    });

    it('passes when no Origin header present', () => {
      const next = jest.fn();
      middleware(createMockReq({}), createMockRes() as ServerResponse, next);
      expect(next).toHaveBeenCalled();
    });

    it('passes valid Origin', () => {
      const next = jest.fn();
      middleware(createMockReq({ origin: 'https://app.example.com' }), createMockRes() as ServerResponse, next);
      expect(next).toHaveBeenCalled();
    });

    it('rejects invalid Origin with 403', () => {
      const next = jest.fn();
      const res = createMockRes();
      middleware(createMockReq({ origin: 'https://evil.com' }), res as ServerResponse, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.body).toEqual(expect.objectContaining({ message: 'Invalid Origin header' }));
    });
  });

  describe('when enabled with both allowedHosts and allowedOrigins', () => {
    const middleware = createHostValidationMiddleware({
      enabled: true,
      allowedHosts: ['localhost:3001'],
      allowedOrigins: ['https://app.example.com'],
    });

    it('passes when both are valid', () => {
      const next = jest.fn();
      middleware(
        createMockReq({ host: 'localhost:3001', origin: 'https://app.example.com' }),
        createMockRes() as ServerResponse,
        next,
      );
      expect(next).toHaveBeenCalled();
    });

    it('rejects when host is invalid (even if origin is valid)', () => {
      const next = jest.fn();
      const res = createMockRes();
      middleware(createMockReq({ host: 'evil.com', origin: 'https://app.example.com' }), res as ServerResponse, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });
  });
});

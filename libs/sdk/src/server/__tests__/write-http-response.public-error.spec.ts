/**
 * writeHttpResponse — PublicMcpError rendering (#471)
 *
 * The flow runner renders a thrown PublicMcpError as a JSON response carrying
 * its real statusCode and (when present) a `WWW-Authenticate` challenge. This
 * verifies the materialization end of that pipeline: the exact output object
 * the catch block builds for a 401-with-challenge produces status 401, the
 * WWW-Authenticate header, and the public message body.
 */
import 'reflect-metadata';

import { UnauthorizedError } from '../../errors';
import { writeHttpResponse } from '../server.validation';

function makeRes() {
  const headers: Record<string, unknown> = {};
  let statusCode = 200;
  let jsonBody: unknown;
  const res: any = {
    setHeader: jest.fn((k: string, v: unknown) => {
      headers[k] = v;
    }),
    getHeader: jest.fn((k: string) => headers[k]),
    status: jest.fn((c: number) => {
      statusCode = c;
      return res;
    }),
    json: jest.fn((b: unknown) => {
      jsonBody = b;
    }),
    end: jest.fn(),
  };
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get jsonBody() {
      return jsonBody;
    },
    headers,
  };
}

describe('writeHttpResponse — 401 PublicMcpError with WWW-Authenticate (#471)', () => {
  it('emits status 401, the Bearer challenge header, and the public message', async () => {
    const err = new UnauthorizedError('Session could not be reconstructed for the provided token.');
    const mock = makeRes();

    // This is the exact shape the flow.instance catch block builds for a
    // PublicMcpError that carries a `wwwAuthenticate` challenge.
    await writeHttpResponse(mock.res, {
      kind: 'json',
      status: err.statusCode,
      body: { error: err.getPublicMessage() },
      headers: { 'WWW-Authenticate': 'Bearer' },
    });

    expect(mock.statusCode).toBe(401);
    expect(mock.headers['WWW-Authenticate']).toBe('Bearer');
    expect(mock.jsonBody).toEqual({ error: 'Session could not be reconstructed for the provided token.' });
  });

  it('still renders a 401 body when no challenge header is provided', async () => {
    const mock = makeRes();
    await writeHttpResponse(mock.res, {
      kind: 'json',
      status: 401,
      body: { error: 'Unauthorized' },
    });
    expect(mock.statusCode).toBe(401);
    expect(mock.headers['WWW-Authenticate']).toBeUndefined();
    expect(mock.jsonBody).toEqual({ error: 'Unauthorized' });
  });
});

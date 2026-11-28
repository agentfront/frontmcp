// The node:http host answers every request as the Express host does, with Express 4 installed (#948).
import {
  EXCHANGES,
  normalized,
  sdkLikeRoutes,
  send,
  startPair,
  type Answer,
  type HostPair,
} from './node-http.host.parity';

it('runs the Express host on Express 4', () => {
  expect((jest.requireActual('express') as { query?: unknown }).query).toBeInstanceOf(Function);
});

// A stack trace names the framework's own files, which differ; its first line is the error.
function withoutStackFrames(answer: Answer): Answer {
  if (!String(answer.headers['content-type']).startsWith('text/html')) return answer;
  const body = answer.body.replace(/(<br> &nbsp; &nbsp;at [^<]*)+/g, '<br>[frames]');
  const { 'content-length': _length, ...headers } = answer.headers;
  return { ...answer, headers, body };
}

describe.each([
  ['default options', undefined],
  ['CORS on and a 1kb body limit', { cors: { origin: ['http://127.0.0.1'], credentials: true }, bodyLimit: '1kb' }],
  ['explicit allowed hosts', { security: { dnsRebindingProtection: { allowedHosts: ['127.0.0.1'] } } }],
])('the node:http host and the Express 4 host, with %s', (_name, options) => {
  let pair: HostPair;

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    pair = await startPair({ major: 4 }, options as never, sdkLikeRoutes);
  });

  afterAll(async () => {
    await pair.close();
    jest.restoreAllMocks();
  });

  it.each(
    EXCHANGES.map((exchange) => [
      `${exchange.method} ${exchange.path} ${JSON.stringify(exchange.headers ?? {})}`,
      exchange,
    ]),
  )('answer %s the same', async (_label, exchange) => {
    const viaExpress = normalized(await send(pair.express, exchange), pair.express);
    const viaNative = normalized(await send(pair.native, exchange), pair.native);
    expect(withoutStackFrames(viaNative)).toEqual(withoutStackFrames(viaExpress));
  });
});

describe('the node:http host and the Express 4 host in production', () => {
  let pair: HostPair;
  const env = process.env['NODE_ENV'];

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    pair = await startPair({ major: 4 }, undefined, sdkLikeRoutes);
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = env;
    await pair.close();
    jest.restoreAllMocks();
  });

  it.each(EXCHANGES.map((exchange) => [`${exchange.method} ${exchange.path}`, exchange]))(
    'answer %s byte for byte',
    async (_label, exchange) => {
      const viaExpress = normalized(await send(pair.express, exchange), pair.express);
      const viaNative = normalized(await send(pair.native, exchange), pair.native);
      expect(viaNative).toEqual(viaExpress);
    },
  );
});

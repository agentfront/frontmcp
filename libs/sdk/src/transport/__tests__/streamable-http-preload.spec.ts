import { loadStreamableHttpTransport } from '../adapters/transport.streamable-http.adapter';
import { loadStreamableHttpTransportOnStart } from '../streamable-http-preload';

jest.mock('../adapters/transport.streamable-http.adapter', () => ({
  loadStreamableHttpTransport: jest.fn().mockResolvedValue(undefined),
}));

const loadTransport = loadStreamableHttpTransport as jest.MockedFunction<typeof loadStreamableHttpTransport>;
const flushImmediates = () => new Promise((resolve) => setImmediate(resolve));

function serverWith(protocol: unknown) {
  const onStarted: Array<() => void | Promise<void>> = [];
  const scope = {
    metadata: { transport: { protocol } },
    onServerStarted: (callback: () => void | Promise<void>) => onStarted.push(callback),
    logger: { verbose: jest.fn() },
  };
  loadStreamableHttpTransportOnStart(scope as never);
  const listen = async () => {
    for (const callback of onStarted) await callback();
    await flushImmediates();
  };
  return { scope, listen };
}

const ONLY = { sse: false, streamable: false, json: false, stateless: false, legacy: false };

describe('loadStreamableHttpTransportOnStart', () => {
  beforeEach(() => loadTransport.mockReset().mockResolvedValue(undefined));

  it.each([
    ['the default', undefined],
    ['legacy', 'legacy'],
    ['modern', 'modern'],
    ['stateless-api', 'stateless-api'],
    ['full', 'full'],
    ['streamable', { ...ONLY, streamable: true }],
    ['stateless', { ...ONLY, stateless: true }],
    ['json', { ...ONLY, json: true }],
  ])('loads the Streamable HTTP transport once a server with %s protocol listens', async (_name, protocol) => {
    const server = serverWith(protocol);
    expect(loadTransport).not.toHaveBeenCalled();

    await server.listen();
    expect(loadTransport).toHaveBeenCalledTimes(1);
  });

  it('leaves it to the first session on a server that serves only legacy SSE', async () => {
    await serverWith({ ...ONLY, legacy: true, sse: true }).listen();
    expect(loadTransport).not.toHaveBeenCalled();
  });

  it('keeps serving when the transport fails to load, which the first session then reports', async () => {
    loadTransport.mockRejectedValue(new Error('missing module'));
    const server = serverWith('modern');

    await server.listen();
    await flushImmediates();
    expect(server.scope.logger.verbose).toHaveBeenCalledWith(
      'Streamable HTTP transport preload failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });
});

import { MockCimdServer } from '../mock-cimd-server';

/** The server's request handler, called without a socket. */
function handlerOf(server: MockCimdServer): (req: unknown, res: unknown) => void {
  const handleRequest = (server as unknown as { handleRequest(req: unknown, res: unknown): void }).handleRequest;
  return handleRequest.bind(server);
}

describe('MockCimdServer', () => {
  it.each([null, undefined, 42, 'text'])('serves a registered invalid document %p without throwing', (document) => {
    const server = new MockCimdServer();
    (server as unknown as { _info: object })._info = { baseUrl: 'http://localhost:0', port: 0 };
    server.registerInvalidDocument('/clients/invalid/metadata.json', document);
    const res = { setHeader: jest.fn(), writeHead: jest.fn(), end: jest.fn() };

    expect(() => handlerOf(server)({ url: '/clients/invalid/metadata.json', method: 'GET' }, res)).not.toThrow();
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json' }));
    expect(res.end).toHaveBeenCalledWith(JSON.stringify(document));
  });
});

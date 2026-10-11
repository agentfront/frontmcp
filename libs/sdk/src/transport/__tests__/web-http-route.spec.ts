/**
 * A route served on the web-fetch adapter whose handler fails after it started its response: the
 * body errors (the client sees an incomplete response, as when the Express host drops the
 * connection), and the error is logged for the operator.
 */
import { type FrontMcpLogger, type ServerRequest, type ServerResponse } from '../../common';
import { type RegisteredHttpRoute } from '../../server/custom-routes.helper';
import { serveHttpRouteWeb } from '../web-http-route';

describe('serveHttpRouteWeb', () => {
  it('logs a failure after the response started and errors its body', async () => {
    const failure = new Error('the export failed midway');
    const route: RegisteredHttpRoute = {
      method: 'GET',
      path: '/exports/:id',
      handler: async (_req: ServerRequest, res: ServerResponse) => {
        res.writeHead(200, { 'Content-Type': 'text/csv' });
        res.write('id,total\n');
        await Promise.resolve();
        throw failure;
      },
    };
    const logger = { error: jest.fn() } as unknown as FrontMcpLogger;
    const request = { method: 'GET', path: '/exports/7', headers: {} } as unknown as ServerRequest;

    const response = await serveHttpRouteWeb([route], request, logger);
    const reader = response?.body?.getReader();
    if (!reader) throw new Error('the route answered no body');

    expect(new TextDecoder().decode((await reader.read()).value)).toBe('id,total\n');
    await expect(reader.read()).rejects.toBe(failure);
    expect(logger.error).toHaveBeenCalledWith('HTTP route GET /exports/:id failed after its response started', failure);
    expect(request.params).toEqual({ id: '7' });
  });
});

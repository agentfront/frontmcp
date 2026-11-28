/**
 * @FrontMcp decorator in a browser or web worker: a page can't listen, so importing a decorated server module there
 * must not start an HTTP server. Up to 1.13 it called bootstrap(), which failed with "ExpressHostAdapter is not
 * available in browser environments" and logged "[FrontMCP] server failed to start".
 */
import 'reflect-metadata';

import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { FrontMcp } from '../front-mcp.decorator';

const bootstrapMock = jest.fn().mockResolvedValue(undefined);

jest.mock('../../../front-mcp/front-mcp', () => ({
  get FrontMcpInstance() {
    return { bootstrap: bootstrapMock };
  },
}));
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;
const config = { info: { name: 'browser-dec-test', version: '1.0.0' }, apps: [] };
const serverLoaded = () => new Promise((resolve) => setImmediate(resolve));

describe('FrontMcp decorator in a browser', () => {
  afterEach(() => {
    jest.clearAllMocks();
    runtimeContext.mockImplementation(realRuntimeContext);
  });

  it('does not start an HTTP server in a page or web worker', async () => {
    runtimeContext.mockImplementation(() => ({ ...realRuntimeContext(), runtime: 'browser' }));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    @FrontMcp(config as never)
    class PageServer {}
    void PageServer;
    await serverLoaded();

    expect(bootstrapMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('still starts the HTTP server on Node', async () => {
    @FrontMcp(config as never)
    class NodeServer {}
    void NodeServer;
    await serverLoaded();

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });
});

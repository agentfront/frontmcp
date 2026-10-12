/**
 * @FrontMcp decorator — stdio auto-serve routing (#448 / #451).
 *
 * When `FRONTMCP_STDIO=1` is set before the decorated server module is
 * imported (as the `--stdio` runner does), the decorator must serve over stdio
 * via `FrontMcpInstance.runStdio()` instead of starting the HTTP server via
 * `FrontMcpInstance.bootstrap()` — so a stdio server never binds a TCP port.
 */
import 'reflect-metadata';

import { FrontMcp } from '../front-mcp.decorator';

const runStdioMock = jest.fn().mockResolvedValue(undefined);
const bootstrapMock = jest.fn().mockResolvedValue(undefined);
const createHandlerMock = jest.fn().mockResolvedValue(undefined);
let mockServerModuleError: Error | undefined;

// Mock the module the decorator loads on demand, to observe which entry point it routes to without booting a server
jest.mock('../../../front-mcp/front-mcp', () => ({
  get FrontMcpInstance() {
    if (mockServerModuleError) throw mockServerModuleError;
    return { runStdio: runStdioMock, bootstrap: bootstrapMock, createHandler: createHandlerMock };
  },
}));

const STDIO = 'FRONTMCP_STDIO';
const SERVERLESS = 'FRONTMCP_SERVERLESS';
const SCHEMA_EXTRACT = 'FRONTMCP_SCHEMA_EXTRACT';
const TASK_ID = 'FRONTMCP_RUN_TASK_ID';

describe('FrontMcp decorator — stdio auto-serve (FRONTMCP_STDIO)', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    jest.clearAllMocks();
    for (const k of [STDIO, SERVERLESS, SCHEMA_EXTRACT, TASK_ID]) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of [STDIO, SERVERLESS, SCHEMA_EXTRACT, TASK_ID]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const config = { info: { name: 'stdio-dec-test', version: '1.0.0' }, apps: [] };
  const serverLoaded = () => new Promise((resolve) => setImmediate(resolve));

  it('serves over stdio (not HTTP) when FRONTMCP_STDIO=1', async () => {
    process.env[STDIO] = '1';

    @FrontMcp(config as never)
    class S {}
    void S;
    await serverLoaded();

    expect(runStdioMock).toHaveBeenCalledTimes(1);
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it('bootstraps the HTTP server when FRONTMCP_STDIO is unset', async () => {
    @FrontMcp(config as never)
    class S {}
    void S;
    await serverLoaded();

    expect(bootstrapMock).toHaveBeenCalledTimes(1);
    expect(runStdioMock).not.toHaveBeenCalled();
  });

  it('does not auto-serve at all when serve:false, even with FRONTMCP_STDIO=1', async () => {
    process.env[STDIO] = '1';

    @FrontMcp({ ...config, serve: false } as never)
    class S {}
    void S;
    await serverLoaded();

    expect(runStdioMock).not.toHaveBeenCalled();
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it('lets schema-extract take precedence over stdio (metadata only, no serve)', async () => {
    process.env[STDIO] = '1';
    process.env[SCHEMA_EXTRACT] = '1';

    @FrontMcp(config as never)
    class S {}
    void S;
    await serverLoaded();

    expect(runStdioMock).not.toHaveBeenCalled();
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  describe('when the server fails to start', () => {
    let exit: jest.SpyInstance;
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      exit.mockRestore();
      consoleError.mockRestore();
    });

    it('logs the failure and exits when bootstrap rejects', async () => {
      const failure = new Error('port in use');
      bootstrapMock.mockRejectedValueOnce(failure);

      FrontMcp(config as never)(class S {});
      await serverLoaded();

      expect(consoleError).toHaveBeenCalledWith('[FrontMCP] server failed to start:', failure);
      expect(exit).toHaveBeenCalledWith(1);
    });

    it('logs the failure and exits when the server module fails to load', async () => {
      const failure = new Error('server module failed to load');
      mockServerModuleError = failure;
      try {
        FrontMcp(config as never)(class S {});
        await serverLoaded();
      } finally {
        mockServerModuleError = undefined;
      }

      expect(consoleError).toHaveBeenCalledWith('[FrontMCP] server failed to start:', failure);
      expect(exit).toHaveBeenCalledWith(1);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });
});

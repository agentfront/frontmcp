import 'reflect-metadata';

import { getRuntimeContext, type RuntimeContext } from '@frontmcp/utils';

import { BrowserEntryPointUnavailableError, InternalMcpError } from '../../errors';
import { FrontMcpInstance } from '../front-mcp';

// The browser and worker builds resolve `#shared-server` to this stub.
jest.mock('#shared-server', () => jest.requireActual('../../shared/browser-shared-server'));
jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const runtimeContext = getRuntimeContext as jest.MockedFunction<typeof getRuntimeContext>;
const realRuntimeContext = jest.requireActual('@frontmcp/utils').getRuntimeContext as () => RuntimeContext;

const config = { info: { name: 'node-only-entry-points', version: '1.0.0' }, apps: [] };

describe('the Node-only entry points in a browser', () => {
  beforeEach(() => {
    runtimeContext.mockImplementation(() => ({ ...realRuntimeContext(), runtime: 'browser' }));
  });

  afterEach(() => {
    runtimeContext.mockImplementation(realRuntimeContext);
  });

  it('runShared() refuses with the browser build of the shared local server', async () => {
    const refusal = FrontMcpInstance.runShared(config, { key: 'page' }).catch((error: unknown) => error);

    await expect(refusal).resolves.toBeInstanceOf(BrowserEntryPointUnavailableError);
    await expect(refusal).resolves.toBeInstanceOf(InternalMcpError);
    await expect(refusal).resolves.toMatchObject({
      code: 'BROWSER_ENTRY_POINT_UNAVAILABLE',
      entryPoint: 'runShared',
      message:
        'A browser cannot run runShared(): the shared local server needs stdio, a child process and a Unix socket ' +
        'or loopback port. Call it from a Node entry, and use create() in a page',
    });
  });

  it('runUnixSocket() refuses before it builds a server', async () => {
    const refusal = FrontMcpInstance.runUnixSocket({ ...config, socketPath: '/tmp/page.sock' }).catch(
      (error: unknown) => error,
    );

    await expect(refusal).resolves.toBeInstanceOf(BrowserEntryPointUnavailableError);
    await expect(refusal).resolves.toMatchObject({
      code: 'BROWSER_ENTRY_POINT_UNAVAILABLE',
      entryPoint: 'runUnixSocket',
      message:
        'A browser cannot run runUnixSocket(): a page cannot listen on a Unix socket. Call it from a Node entry, ' +
        'and use create() in a page',
    });
  });
});

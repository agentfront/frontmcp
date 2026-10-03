import 'reflect-metadata';

import { App, LogLevel, Tool, ToolContext } from '../../common';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import type { Scope } from '../scope.instance';

/**
 * `scope.onDispose()` lets plugins release what they hold outside the scope. It fires from
 * `Scope.dispose()` and from `dispose()` on the server `create()` returns, where no HTTP server
 * starts (so `onServerStarted()` never would).
 */

@Tool({ name: 'noop', inputSchema: {} })
class NoopTool extends ToolContext {
  async execute() {
    return {};
  }
}

@App({ id: 'dispose-app', name: 'Dispose', tools: [NoopTool] })
class DisposeApp {}

const serverConfig = {
  info: { name: 'scope-dispose', version: '1.0.0' },
  apps: [DisposeApp],
  logging: { level: LogLevel.Off },
};

async function createScope(): Promise<Scope> {
  const [scope] = (await FrontMcpInstance.createForGraph(serverConfig)).getScopes() as Scope[];
  return scope;
}

describe('scope.onDispose()', () => {
  it('runs the callbacks once, in reverse order of registration', async () => {
    const scope = await createScope();
    const calls: string[] = [];
    scope.onDispose(() => {
      calls.push('first');
    });
    scope.onDispose(async () => {
      calls.push('second');
    });

    await scope.dispose();
    await scope.dispose();

    expect(calls).toEqual(['second', 'first']);
  });

  it('does not run a callback that was removed', async () => {
    const scope = await createScope();
    const callback = jest.fn();
    const remove = scope.onDispose(callback);

    remove();
    remove();
    await scope.dispose();

    expect(callback).not.toHaveBeenCalled();
  });

  it('keeps running the other callbacks when one throws, and logs the failure', async () => {
    const scope = await createScope();
    const warn = jest.spyOn(scope.logger, 'warn');
    const after = jest.fn();
    scope.onDispose(after);
    scope.onDispose(() => {
      throw new Error('boom');
    });

    await scope.dispose();

    expect(after).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('logs a non-Error failure too', async () => {
    const scope = await createScope();
    const warn = jest.spyOn(scope.logger, 'warn');
    scope.onDispose(() => Promise.reject('plain failure'));

    await scope.dispose();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('plain failure'));
  });

  it('runs a callback registered after the scope was disposed right away', async () => {
    const scope = await createScope();
    await scope.dispose();
    const late = jest.fn();

    const remove = scope.onDispose(late);
    await Promise.resolve();

    expect(late).toHaveBeenCalledTimes(1);
    expect(() => remove()).not.toThrow();
  });

  it('fires from dispose() on the server createDirect() returns', async () => {
    const instance = await FrontMcpInstance.createForGraph(serverConfig);
    const [scope] = instance.getScopes() as Scope[];
    const { DirectMcpServerImpl } = await import('../../direct/direct-server');
    const server = new DirectMcpServerImpl(scope);
    const callback = jest.fn();
    scope.onDispose(callback);

    await server.dispose();

    expect(callback).toHaveBeenCalledTimes(1);
  });
});

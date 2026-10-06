/**
 * Graceful shutdown of the HTTP server (#712). `bootstrap()` used to start the HTTP server with
 * no SIGTERM/SIGINT handler, so a stopped pod never stopped its HA heartbeat and its sessions
 * answered 503 until the heartbeat expired; channels and Redis were not closed either.
 */
import 'reflect-metadata';

import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import type * as net from 'node:net';

import { App, frontMcpMetadataSchema, LogLevel, Tool, ToolContext } from '../../common';
import { type Scope } from '../../scope/scope.instance';
import { FrontMcpInstance } from '../front-mcp';
import { exitOnShutdownSignals } from '../shutdown-signals';

@Tool({ name: 'ping', inputSchema: {} })
class PingTool extends ToolContext {
  async execute() {
    return { pong: true };
  }
}

@App({ id: 'demo', name: 'Demo', tools: [PingTool] })
class DemoApp {}

class FakeProcess extends EventEmitter {
  readonly exit = jest.fn();
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('exitOnShutdownSignals', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('shuts down once on %s and exits 0', async (signal) => {
    const target = new FakeProcess();
    const shutdown = jest.fn().mockResolvedValue(undefined);
    exitOnShutdownSignals(shutdown, { target });

    target.emit(signal);
    target.emit(signal);
    await flush();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(target.exit).toHaveBeenCalledWith(0);
  });

  it('exits 1 when the shutdown fails', async () => {
    const target = new FakeProcess();
    exitOnShutdownSignals(jest.fn().mockRejectedValue(new Error('redis gone')), {
      target,
      logger: { error: jest.fn() },
    });

    target.emit('SIGTERM');
    await flush();

    expect(target.exit).toHaveBeenCalledWith(1);
  });

  it('exits 1 at the deadline when the shutdown hangs', async () => {
    const target = new FakeProcess();
    exitOnShutdownSignals(() => new Promise<void>(() => undefined), { target, deadlineMs: 10 });

    target.emit('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(target.exit).toHaveBeenCalledWith(1);
  });

  it('stops listening once removed', () => {
    const target = new FakeProcess();
    const shutdown = jest.fn().mockResolvedValue(undefined);
    const remove = exitOnShutdownSignals(shutdown, { target });

    remove();
    target.emit('SIGTERM');

    expect(shutdown).not.toHaveBeenCalled();
    expect(target.listenerCount('SIGTERM')).toBe(0);
  });
});

describe('FrontMcpInstance.shutdown()', () => {
  async function startServer(): Promise<{ instance: FrontMcpInstance; server: http.Server }> {
    const opened: http.Server[] = [];
    const realCreateServer = http.createServer.bind(http);
    const spy = jest.spyOn(http, 'createServer').mockImplementation(((...args: never[]) => {
      const created = (realCreateServer as (...a: never[]) => http.Server)(...args);
      opened.push(created);
      return created;
    }) as never);
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const instance = new FrontMcpInstance(
        frontMcpMetadataSchema.parse({
          info: { name: 'graceful', version: '1.0.0' },
          apps: [DemoApp],
          logging: { level: LogLevel.Off },
          http: { port: 0 },
        }),
      );
      await instance.ready;
      await instance.start();
      return { instance, server: opened[0] };
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  }

  it('stops accepting connections, shuts every scope down and disposes it', async () => {
    const { instance, server } = await startServer();
    const scopes = instance.getScopes() as Scope[];
    const shutdownSpies = scopes.map((scope) => jest.spyOn(scope, 'shutdown'));
    const disposed = jest.fn();
    scopes[0].onDispose(disposed);

    await instance.shutdown();

    expect(server.listening).toBe(false);
    for (const spy of shutdownSpies) expect(spy).toHaveBeenCalledTimes(1);
    expect(disposed).toHaveBeenCalledTimes(1);
  });

  it('closes an idle keep-alive connection instead of waiting for it', async () => {
    const { instance, server } = await startServer();
    const { port } = server.address() as net.AddressInfo;
    const agent = new http.Agent({ keepAlive: true });
    const { socketClosed } = await new Promise<{ socketClosed: Promise<void> }>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/healthz', agent }, (response) => {
          const socket = response.socket;
          const closed = new Promise<void>((done) => socket.once('close', () => done()));
          response.resume();
          response.once('end', () => resolve({ socketClosed: closed }));
        })
        .once('error', reject);
    });

    const started = Date.now();
    await instance.shutdown();
    await socketClosed;
    agent.destroy();

    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('shuts down once however often it is called', async () => {
    const { instance } = await startServer();
    const scope = instance.getScopes()[0] as Scope;
    const shutdownSpy = jest.spyOn(scope, 'shutdown');

    await Promise.all([instance.shutdown(), instance.shutdown()]);

    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });
});

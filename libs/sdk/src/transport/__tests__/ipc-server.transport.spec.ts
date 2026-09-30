import { IPC_READY_MESSAGE, IpcServerTransport, isIpcStdioRequested } from '../ipc-server.transport';

describe('IpcServerTransport (frontmcp dev --stdio --serve)', () => {
  const originalSend = process.send;
  const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
  const originalEnv = process.env['FRONTMCP_DEV_STDIO_FD'];
  let sent: unknown[];

  beforeEach(() => {
    sent = [];
    process.send = ((message: unknown, cb?: (err: Error | null) => void) => {
      sent.push(message);
      cb?.(null);
      return true;
    }) as typeof process.send;
    Object.defineProperty(process, 'connected', { value: true, configurable: true });
  });

  afterEach(() => {
    process.send = originalSend;
    if (originalConnected) Object.defineProperty(process, 'connected', originalConnected);
    else delete (process as { connected?: boolean }).connected;
    if (originalEnv === undefined) delete process.env['FRONTMCP_DEV_STDIO_FD'];
    else process.env['FRONTMCP_DEV_STDIO_FD'] = originalEnv;
    process.removeAllListeners('message');
    process.removeAllListeners('disconnect');
  });

  it('announces readiness on the IPC channel once started', async () => {
    const transport = new IpcServerTransport();
    await transport.start();
    expect(sent).toEqual([IPC_READY_MESSAGE]);
    await transport.close();
  });

  it('delivers JSON-RPC messages from the parent to onmessage and ignores internal markers', async () => {
    const transport = new IpcServerTransport();
    const received: unknown[] = [];
    transport.onmessage = (m) => received.push(m);
    await transport.start();

    process.emit('message', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, undefined as never);
    process.emit('message', { __frontmcp: 'ready' }, undefined as never);
    process.emit('message', 'not-an-object' as never, undefined as never);

    expect(received).toEqual([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]);
    await transport.close();
  });

  it('sends responses to the parent', async () => {
    const transport = new IpcServerTransport();
    await transport.start();
    sent.length = 0;

    await transport.send({ jsonrpc: '2.0', id: 1, result: {} });

    expect(sent).toEqual([{ jsonrpc: '2.0', id: 1, result: {} }]);
    await transport.close();
  });

  it('rejects send() once the channel is closed', async () => {
    const transport = new IpcServerTransport();
    await transport.start();
    Object.defineProperty(process, 'connected', { value: false, configurable: true });

    await expect(transport.send({ jsonrpc: '2.0', id: 1, result: {} })).rejects.toThrow('IPC channel is closed');
  });

  it('reports onclose when the parent disconnects', async () => {
    const transport = new IpcServerTransport();
    const onclose = jest.fn();
    transport.onclose = onclose;
    await transport.start();

    process.emit('disconnect');

    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('refuses to start without an IPC channel and cannot start twice', async () => {
    const started = new IpcServerTransport();
    await started.start();
    await expect(started.start()).rejects.toThrow('already started');
    await started.close();

    process.send = undefined;
    await expect(new IpcServerTransport().start()).rejects.toThrow('IPC channel');
  });

  it('isIpcStdioRequested needs both FRONTMCP_DEV_STDIO_FD and an IPC channel', () => {
    delete process.env['FRONTMCP_DEV_STDIO_FD'];
    expect(isIpcStdioRequested()).toBe(false);
    process.env['FRONTMCP_DEV_STDIO_FD'] = '3';
    expect(isIpcStdioRequested()).toBe(true);
    process.send = undefined;
    expect(isIpcStdioRequested()).toBe(false);
  });
});

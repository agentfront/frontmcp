import type { JSONRPCMessage, Transport } from '@frontmcp/protocol';

/** Marker the child sends on the IPC channel once it can take traffic (`frontmcp dev --stdio --serve`). */
export const IPC_READY_MESSAGE = { __frontmcp: 'ready' } as const;

/**
 * Server transport over the Node IPC channel (`process.send` / `process.on('message')`).
 *
 * Used by `frontmcp dev --stdio --serve`: the dev bridge forks the server with an
 * `ipc` stdio slot and `FRONTMCP_DEV_STDIO_FD=3`, then forwards JSON-RPC frames
 * over that channel instead of a loopback HTTP port.
 */
export class IpcServerTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private started = false;

  private readonly handleMessage = (raw: unknown): void => {
    if (!raw || typeof raw !== 'object' || (raw as { __frontmcp?: unknown }).__frontmcp !== undefined) return;
    this.onmessage?.(raw as JSONRPCMessage);
  };

  private readonly handleDisconnect = (): void => {
    this.onclose?.();
  };

  async start(): Promise<void> {
    if (this.started) throw new Error('IpcServerTransport already started');
    if (typeof process.send !== 'function') {
      throw new Error('IpcServerTransport requires a process forked with an IPC channel');
    }
    this.started = true;
    process.on('message', this.handleMessage);
    process.once('disconnect', this.handleDisconnect);
    process.send(IPC_READY_MESSAGE);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    const send = process.send;
    if (!process.connected || typeof send !== 'function') {
      throw new Error('IPC channel is closed');
    }
    await new Promise<void>((resolve, reject) => {
      send.call(process, message, (err: Error | null) => (err ? reject(err) : resolve()));
    });
  }

  async close(): Promise<void> {
    process.off('message', this.handleMessage);
    process.off('disconnect', this.handleDisconnect);
    this.started = false;
    this.onclose?.();
  }
}

/** True when this process was started by the dev bridge in pipe mode. */
export function isIpcStdioRequested(): boolean {
  return !!process.env['FRONTMCP_DEV_STDIO_FD'] && typeof process.send === 'function';
}

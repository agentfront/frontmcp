/**
 * TCP port probe for low-level e2e tests.
 *
 * Primarily used to assert that a server running in **stdio mode binds no HTTP
 * port** — connect once and report whether anything is listening.
 */
import net from 'node:net';

/**
 * Resolve `true` iff a TCP server is currently accepting connections on
 * `host:port`, otherwise `false`.
 *
 * A refused connection (`ECONNREFUSED`) or a timeout resolves to `false`; a
 * successful connect resolves to `true` and the probe socket is closed
 * immediately. Probing loopback makes "nothing listening" fail fast, so the
 * timeout only guards against a silently-dropped connection.
 *
 * @param port - TCP port to probe
 * @param host - Host/interface to probe (default `127.0.0.1`)
 * @param timeoutMs - Max time to wait for a connection (default `1500`)
 */
export function isTcpPortListening(port: number, host = '127.0.0.1', timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    // The probe is fire-and-forget: never let its socket (or idle timer) keep
    // the event loop alive or delay a test run from exiting.
    socket.unref();
    socket.setTimeout(timeoutMs);

    let settled = false;
    const finish = (listening: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

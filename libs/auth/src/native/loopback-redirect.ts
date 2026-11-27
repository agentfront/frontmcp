import { createServer, type Server } from 'node:http';

import { NativeSignInError } from './native-sign-in.error';

const LOOPBACK_HOST = '127.0.0.1';

export interface LoopbackRedirectOptions {
  /** A port, or an inclusive range to take the first free one from; `0` (the default) is any free port. */
  port?: number | readonly [number, number];
  path: string;
  timeoutMs: number;
  state: string;
  issuer: string;
  /** The server promised an RFC 9207 `iss` on every authorization response. */
  issRequired: boolean;
}

export interface LoopbackRedirect {
  redirectUri: string;
  /** The authorization code, once the browser comes back with one. */
  code: Promise<string>;
  close(): void;
}

/** A one-shot HTTP listener on 127.0.0.1 for the authorization response (RFC 8252 §7.3). */
export async function listenForRedirect(options: LoopbackRedirectOptions): Promise<LoopbackRedirect> {
  const candidates = candidatePorts(options.port ?? 0);
  const server = createServer();
  const port = await listenOnFreePort(server, candidates);
  const redirectUri = `http://${LOOPBACK_HOST}:${port}${options.path}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const close = () => {
    clearTimeout(timer);
    server.close();
    server.closeAllConnections();
  };

  const code = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => {
      close();
      reject(new NativeSignInError('timeout', `No sign-in came back within ${Math.round(options.timeoutMs / 1000)}s`));
    }, options.timeoutMs);
    server.on('request', (req, res) => {
      let url: URL;
      try {
        url = new URL(req.url ?? '/', redirectUri);
      } catch {
        // A target that is no URL (`//`) is not the callback: refuse it, and keep waiting for the callback.
        res.writeHead(400).end();
        return;
      }
      if (url.pathname !== options.path) {
        res.writeHead(404).end();
        return;
      }
      const outcome = readAuthorizationResponse(url.searchParams, options);
      res.writeHead(outcome.ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      res.end(
        outcome.ok
          ? '<!doctype html><title>Signed in</title><p>Signed in. You can close this window.</p>'
          : '<!doctype html><title>Sign-in failed</title><p>Sign-in failed. Return to the application for details.</p>',
        close,
      );
      if (outcome.ok) resolve(outcome.code);
      else reject(outcome.error);
    });
  });
  code.catch(() => undefined);

  return { redirectUri, code, close };
}

function readAuthorizationResponse(
  params: URLSearchParams,
  options: LoopbackRedirectOptions,
): { ok: true; code: string } | { ok: false; error: NativeSignInError } {
  const fail = (code: string, message: string) => ({ ok: false as const, error: new NativeSignInError(code, message) });
  if (params.get('state') !== options.state) {
    return fail('state_mismatch', 'The authorization response does not carry the state this sign-in sent');
  }
  const iss = params.get('iss');
  if (iss !== null ? iss !== options.issuer : options.issRequired) {
    return fail('issuer_mismatch', `The authorization response is not from ${options.issuer}`);
  }
  const error = params.get('error');
  if (error) {
    const description = params.get('error_description');
    return fail(error, description ? `${error}: ${description}` : `The authorization server answered ${error}`);
  }
  const code = params.get('code');
  if (!code) return fail('missing_code', 'The authorization response carries no code');
  return { ok: true, code };
}

/** The ports to try: one port, where `0` is any free one, or an inclusive range of ports from 1 to 65535. */
function candidatePorts(port: unknown): readonly [number, number] {
  const isPort = (value: unknown, lowest: number): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= lowest && value <= 65_535;
  if (isPort(port, 0)) return [port, port];
  // A JavaScript caller can pass anything: only a pair of ports is a range.
  if (Array.isArray(port) && port.length === 2) {
    const [first, last]: unknown[] = port;
    if (isPort(first, 1) && isPort(last, 1) && first <= last) return [first, last];
  }
  const given = Array.isArray(port) ? `[${port.join(', ')}]` : typeof port === 'number' ? String(port) : typeof port;
  throw new NativeSignInError(
    'invalid_port',
    `redirectPort must be a port from 0 to 65535 (0 is any free port), or a range [first, last] of ports from 1 ` +
      `to 65535 with first <= last; got ${given}`,
  );
}

async function listenOnFreePort(server: Server, [first, last]: readonly [number, number]): Promise<number> {
  let lastError: unknown;
  for (let candidate = first; candidate <= last; candidate++) {
    try {
      return await listen(server, candidate);
    } catch (error) {
      lastError = error;
    }
  }
  const range = first === last ? `port ${first}` : `ports ${first}-${last}`;
  throw new NativeSignInError(
    'port_unavailable',
    `Could not listen on ${LOOPBACK_HOST} ${range}: ${describe(lastError)}`,
  );
}

/** One bind attempt, which leaves none of its handlers on the server, however it ends. */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const settle = () => {
      server.off('error', onError);
      server.off('listening', onListening);
    };
    const onError = (error: Error) => {
      settle();
      reject(error);
    };
    const onListening = () => {
      settle();
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen(port, LOOPBACK_HOST);
    } catch (error) {
      settle();
      reject(error);
    }
  });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

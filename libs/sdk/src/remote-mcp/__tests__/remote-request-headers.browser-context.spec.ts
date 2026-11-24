/**
 * A browser without TC39 `AsyncContext` keeps one stack per request in each `AsyncLocalStorage`, and a read returns
 * its newest frame. Two remote calls of one request that overlap, on two connections, must still send each connection
 * only the headers of its own call, including the requests a call sends while the other is open (polling a task).
 * Each connection owns its scopes, so two connections to remotes of the same app id stay apart too.
 */
import { runRequestExclusive } from '@frontmcp/utils';

import {
  createRemoteRequestFetch,
  createRemoteRequestScopes,
  withRemoteRequestHeaders,
} from '../remote-request-headers';

jest.mock('#async-context', () => jest.requireActual('../../../../utils/src/async-context/browser-async-context'));

type Connection = 'first' | 'second';

interface Gate {
  opened: Promise<void>;
  open: () => void;
}

function gate(): Gate {
  const handle: Gate = { opened: Promise.resolve(), open: () => undefined };
  handle.opened = new Promise<void>((resolve) => {
    handle.open = resolve;
  });
  return handle;
}

describe('remote request headers without AsyncContext', () => {
  let sent: Array<{ connection: string; authorization: string | null }>;

  beforeEach(() => {
    sent = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const connection = new URL(String(input)).pathname.slice(1);
      sent.push({ connection, authorization: new Headers(init?.headers).get('authorization') });
      return new Response('{}', { status: 200 });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  interface Call {
    started: Gate;
    poll: Gate;
    polled: Gate;
    end: Gate;
    done: Promise<void>;
  }

  /** A call on `connection`: one request, another once its poll gate opens (as polling a task does), then its end gate. */
  function startCall(connection: Connection, host: string): Call {
    const requestScopes = createRemoteRequestScopes();
    const send = createRemoteRequestFetch(requestScopes, false);
    const call = { started: gate(), poll: gate(), polled: gate(), end: gate() };
    const done = withRemoteRequestHeaders(requestScopes, { authorization: `Bearer ${connection}-token` }, async () => {
      await send(`https://${host}/${connection}`);
      call.started.open();
      await call.poll.opened;
      await send(`https://${host}/${connection}`);
      call.polled.open();
      await call.end.opened;
    });
    return { ...call, done };
  }

  it.each<[string, Connection, Connection, Record<Connection, string>]>([
    ['the later call ends first', 'second', 'first', { first: 'first.test', second: 'second.test' }],
    ['the earlier call ends first', 'first', 'second', { first: 'first.test', second: 'second.test' }],
    [
      'both connections reach a remote of the same app id',
      'second',
      'first',
      { first: 'app.test', second: 'app.test' },
    ],
  ])('sends each connection only its own call’s headers when %s', async (_case, endsFirst, endsLast, hosts) => {
    await runRequestExclusive(async () => {
      const calls = { first: startCall('first', hosts.first), second: startCall('second', hosts.second) };
      await Promise.all([calls.first.started.opened, calls.second.started.opened]);
      for (const connection of ['first', 'second'] as const) {
        calls[connection].poll.open();
        await calls[connection].polled.opened;
      }
      calls[endsFirst].end.open();
      await calls[endsFirst].done;
      calls[endsLast].end.open();
      await calls[endsLast].done;
    });

    expect(sent).toHaveLength(4);
    for (const { connection, authorization } of sent) {
      expect(authorization).toBe(`Bearer ${connection}-token`);
    }
  });
});

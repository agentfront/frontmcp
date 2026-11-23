/**
 * A browser without TC39 `AsyncContext` keeps one stack per request in each `AsyncLocalStorage`, and a read returns
 * its newest frame. Two remote calls of one request that overlap, to two remotes, must still send each remote only
 * the headers of its own call, including the requests a call sends while the other is open (polling a task).
 */
import { runRequestExclusive } from '@frontmcp/utils';

import { createRemoteRequestFetch, withRemoteRequestHeaders } from '../remote-request-headers';

jest.mock('#async-context', () => jest.requireActual('../../../../utils/src/async-context/browser-async-context'));

type Remote = 'first' | 'second';

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
  let sent: Array<{ remote: string; authorization: string | null }>;

  beforeEach(() => {
    sent = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const remote = new URL(String(input)).hostname;
      sent.push({ remote, authorization: new Headers(init?.headers).get('authorization') });
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

  /** A call to `remote`: one request, another once its poll gate opens (as polling a task does), then its end gate. */
  function startCall(remote: Remote): Call {
    const send = createRemoteRequestFetch(remote, false);
    const call = { started: gate(), poll: gate(), polled: gate(), end: gate() };
    const done = withRemoteRequestHeaders(remote, { authorization: `Bearer ${remote}-token` }, async () => {
      await send(`https://${remote}/mcp`);
      call.started.open();
      await call.poll.opened;
      await send(`https://${remote}/mcp`);
      call.polled.open();
      await call.end.opened;
    });
    return { ...call, done };
  }

  it.each<[string, Remote, Remote]>([
    ['the later call ends first', 'second', 'first'],
    ['the earlier call ends first', 'first', 'second'],
  ])('sends each remote only its own call’s headers when %s', async (_order, endsFirst, endsLast) => {
    await runRequestExclusive(async () => {
      const calls = { first: startCall('first'), second: startCall('second') };
      await Promise.all([calls.first.started.opened, calls.second.started.opened]);
      for (const remote of ['first', 'second'] as const) {
        calls[remote].poll.open();
        await calls[remote].polled.opened;
      }
      calls[endsFirst].end.open();
      await calls[endsFirst].done;
      calls[endsLast].end.open();
      await calls[endsLast].done;
    });

    expect(sent).toHaveLength(4);
    for (const { remote, authorization } of sent) {
      expect(authorization).toBe(`Bearer ${remote}-token`);
    }
  });
});

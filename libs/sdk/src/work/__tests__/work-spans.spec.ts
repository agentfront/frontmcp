/**
 * Work spans: `trackWork()`, the trackers that follow them, and the spans the SDK opens for each `@HttpRoute`
 * request, `@Duty` run and `@Worker` run.
 */
import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createTestFetchServer } from '../../__test-utils__/helpers/mcp-20260728.helpers';
import { App, Duty, HttpRoute, LogLevel, Worker, type WorkerRunContext } from '../../common';
import { HttpRouteContext } from '../../common/interfaces/http-route.interface';
import { createContainer, type FrontMcpContainer } from '../../provider/create-container';
import { resourceStore } from '../../resource/materialized';
import { openWorkSpan, registerWorkTracker, trackWork, withWorkSpan, type WorkSpan } from '../index';

/** What a tracker saw: each span as it opened, and as it ended. */
function recordingTracker() {
  const events: string[] = [];
  const stop = registerWorkTracker({
    begin: ({ kind, name }: WorkSpan) => {
      events.push(`begin ${kind} ${name}`);
      return () => events.push(`end ${kind} ${name}`);
    },
  });
  return { events, stop };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function until(condition: () => boolean, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(10);
  }
}

describe('work spans', () => {
  let stops: Array<() => void>;

  beforeEach(() => {
    stops = [];
  });

  afterEach(() => {
    for (const stop of stops) stop();
  });

  function track() {
    const tracker = recordingTracker();
    stops.push(tracker.stop);
    return tracker.events;
  }

  describe('trackWork()', () => {
    it('opens a work span named by its label, and ends it once', () => {
      const events = track();

      const end = trackWork('ingest:batch');
      end();
      end();

      expect(events).toEqual(['begin work ingest:batch', 'end work ingest:batch']);
    });

    it('opens nothing, and ends nothing, while no tracker follows the spans', () => {
      const end = trackWork('quiet');

      expect(() => end()).not.toThrow();
    });

    it('tells every tracker, and keeps the work going when one of them throws', () => {
      const events = track();
      stops.push(
        registerWorkTracker({
          begin: () => {
            throw new Error('a tracker failed');
          },
        }),
        registerWorkTracker({
          begin: () => () => {
            throw new Error('an end failed');
          },
        }),
      );

      const end = trackWork('sync');

      expect(() => end()).not.toThrow();
      expect(events).toEqual(['begin work sync', 'end work sync']);
    });

    it('stops telling a tracker once it stops following', () => {
      const tracker = recordingTracker();

      tracker.stop();
      trackWork('after')();

      expect(tracker.events).toEqual([]);
    });

    it('shares its trackers with another copy of the SDK in the process', () => {
      const events = track();
      const trackers = (globalThis as Record<symbol, Set<unknown>>)[Symbol.for('frontmcp:work-trackers')];

      expect(trackers?.size).toBeGreaterThan(0);
      openWorkSpan('duty', 'nightly')();
      expect(events).toEqual(['begin duty nightly', 'end duty nightly']);
    });
  });

  describe('withWorkSpan()', () => {
    it('ends the span when the work settles, failed or not', async () => {
      const events = track();

      await expect(withWorkSpan('worker', 'mailbox', async () => 'done')).resolves.toBe('done');
      await expect(
        withWorkSpan('worker', 'mailbox', async () => {
          throw new Error('the mailbox is gone');
        }),
      ).rejects.toThrow('the mailbox is gone');

      expect(events).toEqual([
        'begin worker mailbox',
        'end worker mailbox',
        'begin worker mailbox',
        'end worker mailbox',
      ]);
    });
  });

  describe('the spans the SDK opens', () => {
    let home: string;
    let previousHome: string | undefined;
    let open: FrontMcpContainer[];
    const quiet = { level: LogLevel.Off, enableConsole: false };

    beforeEach(() => {
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-work-spans-'));
      previousHome = process.env['FRONTMCP_HOME'];
      process.env['FRONTMCP_HOME'] = home;
      open = [];
    });

    afterEach(async () => {
      await Promise.all(open.map((built) => built.dispose()));
      if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
      else process.env['FRONTMCP_HOME'] = previousHome;
      fs.rmSync(home, { recursive: true, force: true });
    });

    it('opens one for each run of a duty, named by the duty', async () => {
      const events = track();

      @Duty({ name: 'nightly-ingest', every: 50, scope: 'machine' })
      class IngestDuty {
        async run(): Promise<void> {
          events.push('duty ran');
        }
      }

      open.push(
        await createContainer({ providers: [IngestDuty], runDuties: true, info: { name: 'spans' }, logging: quiet }),
      );
      await until(() => events.filter((event) => event === 'end duty nightly-ingest').length >= 1);

      expect(events.slice(0, 3)).toEqual(['begin duty nightly-ingest', 'duty ran', 'end duty nightly-ingest']);
    });

    it('opens one for each run of a worker, named by the worker, which ends with the run', async () => {
      const events = track();

      @Worker({ name: 'mailbox', scope: 'process', restart: false })
      class MailboxWorker {
        async run({ signal }: WorkerRunContext): Promise<void> {
          events.push('worker runs');
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        }
      }

      const built = await createContainer({
        providers: [MailboxWorker],
        runBackground: true,
        info: { name: 'spans' },
        logging: quiet,
      });
      await until(() => events.includes('worker runs'));
      expect(events).toEqual(['begin worker mailbox', 'worker runs']);

      await built.dispose();
      expect(events).toEqual(['begin worker mailbox', 'worker runs', 'end worker mailbox']);
    });

    it("opens one for each request of an @HttpRoute and each view of an SSE route, named by the route's declared path", async () => {
      const events = track();
      const store = resourceStore({ coalesceMs: 0 });

      @HttpRoute({ method: 'GET', path: '/reports/:id', auth: 'public' })
      class ReportRoute extends HttpRouteContext {
        handle() {
          events.push(`handled ${this.params['id']}`);
          return { id: this.params['id'] };
        }
      }

      @HttpRoute({ method: 'GET', path: '/feed', auth: 'public', sse: { store, topics: ['feed'] } })
      class FeedRoute extends HttpRouteContext {
        handle() {
          events.push('view');
          return { items: [] };
        }
      }

      @App({ name: 'Reports', routes: [ReportRoute, FeedRoute] })
      class ReportsApp {}

      const { handler } = await createTestFetchServer({
        info: { name: 'spans', version: '1.0.0' },
        apps: [ReportsApp],
        logging: quiet,
      });

      const response = await handler(new Request('http://localhost/reports/42'));
      expect(await response.json()).toEqual({ id: '42' });
      expect(events).toEqual(['begin http GET /reports/:id', 'handled 42', 'end http GET /reports/:id']);

      events.length = 0;
      const stream = await handler(new Request('http://localhost/feed', { headers: { accept: 'text/event-stream' } }));
      const reader = stream.body?.getReader();
      await reader?.read();
      await reader?.cancel();
      expect(events.slice(0, 3)).toEqual(['begin http GET /feed', 'view', 'end http GET /feed']);
    });
  });
});

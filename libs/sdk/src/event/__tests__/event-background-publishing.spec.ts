/**
 * Background code publishes events: a worker, a duty and a plain provider take the publisher in their constructor,
 * and a factory provider injects it by the `EVENT_PUBLISHER` token. They are built before the events are registered.
 */
import 'reflect-metadata';

import * as os from 'node:os';
import * as path from 'node:path';

import { z } from '@frontmcp/lazy-zod';
import { mkdtemp, rm } from '@frontmcp/utils';

import {
  App,
  AsyncProvider,
  Duty,
  event,
  EVENT_PUBLISHER,
  EventPublisher,
  LogLevel,
  Plugin,
  Provider,
  Worker,
  type FlowCtxOf,
  type OnBootstrap,
  type WorkerRunContext,
} from '../../common';
import { EventsNotEnabledError } from '../../errors';
import { FrontMcpInstance } from '../../front-mcp/front-mcp';
import { EventPublishHook } from '../../index';
import { createContainer } from '../../provider/create-container';
import { DeferredEventPublisher } from '../../scope/event-publisher.providers';
import { type Scope } from '../../scope/scope.instance';
import { ScopeEventPublisher } from '../event-publisher';

const clockTicked = event({
  name: 'clock.ticked',
  payloadSchema: { source: z.string(), tick: z.number() },
});

const published: Array<{ source: string; tick: number }> = [];

/** Records each occurrence that reaches `events:publish`. */
@Plugin({ name: 'publish-recorder' })
class PublishRecorderPlugin {
  @EventPublishHook.Did('validate')
  record(ctx: FlowCtxOf<'events:publish'>) {
    published.push(ctx.rawInput.occurrence.data as { source: string; tick: number });
  }
}

/** Publishes a tick every 20 ms until its run is aborted. */
@Worker({ name: 'clock', scope: 'process' })
class ClockWorker {
  constructor(private readonly events: EventPublisher) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    let tick = 0;
    while (!signal.aborted) {
      await this.events.publish(clockTicked, { source: 'worker', tick: tick++ });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

/** Publishes a tick at each of its runs. */
@Duty({ name: 'heartbeat', every: 25, scope: 'machine' })
class HeartbeatDuty {
  private tick = 0;

  constructor(private readonly events: EventPublisher) {}

  async run(): Promise<void> {
    await this.events.publish('clock.ticked', { source: 'duty', tick: this.tick++ });
  }
}

/** A plain provider that publishes for whoever calls it. */
@Provider({ name: 'announcer' })
class Announcer {
  constructor(private readonly events: EventPublisher) {}

  announce(tick: number) {
    return this.events.publish(clockTicked, { source: 'provider', tick });
  }
}

const earlyPublish: { refusal?: unknown } = {};

/** A provider that publishes while it is built, before the server registered its events. */
@Provider({ name: 'early-bird' })
class EarlyBird implements OnBootstrap {
  constructor(private readonly events: EventPublisher) {}

  async onBootstrap(): Promise<void> {
    earlyPublish.refusal = await this.events.publish(clockTicked, { source: 'early', tick: 0 }).catch((error) => error);
  }
}

/** What a factory builds with the publisher it injects by token. */
class Bell {
  constructor(private readonly events: EventPublisher) {}

  ring(tick: number) {
    return this.events.publish(clockTicked, { source: 'factory', tick });
  }
}

const BellProvider = AsyncProvider({
  provide: Bell,
  name: 'bell',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new Bell(events),
});

/** A worker a factory builds, as a runner that emits no constructor types needs it. */
@Worker({ name: 'token-clock', scope: 'process' })
class TokenClockWorker {
  constructor(private readonly events: EventPublisher) {}

  async run({ signal }: WorkerRunContext): Promise<void> {
    let tick = 0;
    while (!signal.aborted) {
      await this.events.publish(clockTicked, { source: 'token-worker', tick: tick++ });
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

const TokenClockWorkerProvider = AsyncProvider({
  provide: TokenClockWorker,
  name: 'token-clock',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new TokenClockWorker(events),
});

/** A duty a factory builds. */
@Duty({ name: 'token-heartbeat', every: 25, scope: 'machine' })
class TokenHeartbeatDuty {
  private tick = 0;

  constructor(private readonly events: EventPublisher) {}

  async run(): Promise<void> {
    await this.events.publish(clockTicked, { source: 'token-duty', tick: this.tick++ });
  }
}

const TokenHeartbeatDutyProvider = AsyncProvider({
  provide: TokenHeartbeatDuty,
  name: 'token-heartbeat',
  inject: () => [EVENT_PUBLISHER] as const,
  useFactory: (events) => new TokenHeartbeatDuty(events),
});

@App({
  id: 'clock',
  name: 'Clock',
  events: [clockTicked],
  providers: [
    ClockWorker,
    HeartbeatDuty,
    Announcer,
    EarlyBird,
    BellProvider,
    TokenClockWorkerProvider,
    TokenHeartbeatDutyProvider,
  ],
})
class ClockApp {}

@App({ id: 'silent', name: 'Silent', providers: [Announcer] })
class AppWithoutEvents {}

/** Waits until a condition holds. */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('publishing from background code', () => {
  let home: string;
  let previousHome: string | undefined;
  let instance: FrontMcpInstance;
  let scope: Scope;

  beforeAll(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'sdk-event-background-'));
    previousHome = process.env['FRONTMCP_HOME'];
    process.env['FRONTMCP_HOME'] = home;
    instance = await FrontMcpInstance.createForGraph({
      info: { name: 'event-background', version: '1.0.0' },
      apps: [ClockApp],
      plugins: [PublishRecorderPlugin],
      logging: { level: LogLevel.Off, enableConsole: false },
    });
    scope = instance.getPrimaryScope() as Scope;
  });

  afterAll(async () => {
    await instance.shutdown();
    if (previousHome === undefined) delete process.env['FRONTMCP_HOME'];
    else process.env['FRONTMCP_HOME'] = previousHome;
    await rm(home, { recursive: true, force: true });
  });

  beforeEach(() => {
    published.length = 0;
  });

  it('gives a provider built before the events a publisher that publishes once they are registered', async () => {
    const announcer = scope.apps.getApps()[0].providers.get(Announcer);

    await expect(announcer.announce(1)).resolves.toEqual({ eventId: expect.stringMatching(/^evt_/), matched: 0 });

    expect(published).toEqual([{ source: 'provider', tick: 1 }]);
  });

  it('gives a factory provider the publisher by the EVENT_PUBLISHER token', async () => {
    const bell = scope.apps.getApps()[0].providers.get(Bell);

    await bell.ring(2);

    expect(published).toEqual([{ source: 'factory', tick: 2 }]);
  });

  it('refuses a publish made while providers are built, before the events are registered', () => {
    expect(earlyPublish.refusal).toBeInstanceOf(EventsNotEnabledError);
  });

  it('keeps EVENT_PUBLISHER the publisher of the scope, and the class token one that publishes through it', () => {
    expect(scope.providers.get(EVENT_PUBLISHER)).toBe(scope.events?.publisher);
    expect(scope.events?.publisher).toBeInstanceOf(ScopeEventPublisher);
    expect(scope.providers.get(EventPublisher)).toBeInstanceOf(DeferredEventPublisher);
  });

  it('lets workers and duties publish once the server serves, built by their class or by a factory', async () => {
    const ticksOf = (source: string) => published.filter((tick) => tick.source === source).map(({ tick }) => tick);
    const sources = ['worker', 'duty', 'token-worker', 'token-duty'];
    expect(published).toEqual([]);

    await instance.emitProvidersReady();
    await until(() => sources.every((source) => ticksOf(source).length >= 2));

    for (const source of sources) expect(ticksOf(source).slice(0, 2)).toEqual([0, 1]);
  });
});

describe('the publisher outside a server', () => {
  it('is not there to build a provider with in createContainer()', async () => {
    const building = createContainer({
      providers: [Announcer],
      logging: { level: LogLevel.Off, enableConsole: false },
    });

    await expect(building).rejects.toThrow('depends on EventPublisher, which is not registered');
  });
});

describe('the publisher a provider takes on a server without events', () => {
  it('refuses to publish, as this.events does', async () => {
    const instance = await FrontMcpInstance.createForGraph({
      info: { name: 'event-background-none', version: '1.0.0' },
      apps: [AppWithoutEvents],
      logging: { level: LogLevel.Off, enableConsole: false },
    });
    const scope = instance.getPrimaryScope() as Scope;
    const announcer = scope.apps.getApps()[0].providers.get(Announcer);

    await expect(announcer.announce(1)).rejects.toThrow(EventsNotEnabledError);
    expect(scope.providers.get(EVENT_PUBLISHER)).toBeInstanceOf(DeferredEventPublisher);
    await instance.shutdown();
  });
});

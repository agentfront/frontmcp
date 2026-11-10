import type { EventOccurrence } from '@frontmcp/protocol';
import { randomUUID, type NamespacedStorage } from '@frontmcp/utils';

import { type EventAudience, type FrontMcpLogger } from '../../common';
import { type BufferedEvent, type EventBuffer } from '../poll/event-buffer';
import { type EventStream } from './event-stream';

export interface EventStreamsOptions {
  buffer: EventBuffer;
  /** `events.subscriptions.maxPerPrincipal`: how many streams one caller may hold open. */
  maxPerPrincipal: number;
  /** A storage with pub/sub carries published occurrences to the streams other processes hold. */
  storage?: NamespacedStorage;
  logger: FrontMcpLogger;
}

/** What one process tells the others about an occurrence it published. */
interface RelayedOccurrence {
  origin: string;
  occurrence: EventOccurrence;
  audience?: EventAudience;
  subscriptionId?: string;
}

/** The pub/sub channel published occurrences are relayed on. */
export const EVENT_RELAY_CHANNEL = 'occurrences';
/** How many streams one process holds open, for all callers together. */
export const MAX_OPEN_STREAMS = 10_000;

/** The open `events/stream` requests of a server: what is published reaches each stream of its event. */
export class EventStreams {
  private readonly streams = new Map<string, Set<EventStream>>();
  private readonly nodeId: string;
  private readonly logger: FrontMcpLogger;
  private stopRelay?: () => Promise<void> | void;
  private openCount = 0;

  constructor(private readonly options: EventStreamsOptions) {
    this.nodeId = randomUUID();
    this.logger = options.logger.child('EventStreams');
  }

  /** Whether occurrences reach the streams of other processes. */
  get isRelayed(): boolean {
    return this.options.storage?.supportsPubSub() === true;
  }

  /** How many streams are open. */
  get size(): number {
    return this.openCount;
  }

  /** Listen for the occurrences other processes publish, when the storage can carry them. */
  async start(): Promise<void> {
    const { storage } = this.options;
    if (!storage || !this.isRelayed) return;
    this.stopRelay = await storage.subscribe(EVENT_RELAY_CHANNEL, (message) => this.receive(message));
  }

  /** Stop listening and end every open stream. */
  async stop(): Promise<void> {
    await this.stopRelay?.();
    this.stopRelay = undefined;
    for (const streams of [...this.streams.values()]) {
      for (const stream of [...streams]) stream.close();
    }
  }

  /** Whether one more stream would exceed what one owner, or the process, may hold open. */
  isFull(principalKey: string | undefined): boolean {
    if (this.openCount >= MAX_OPEN_STREAMS) return true;
    if (principalKey === undefined) return false;
    let held = 0;
    for (const streams of this.streams.values()) {
      for (const stream of streams) {
        if (stream.principalKey === principalKey) held += 1;
      }
    }
    return held >= this.options.maxPerPrincipal;
  }

  /** Keep a stream for as long as it is open. */
  add(stream: EventStream): void {
    const streams = this.streams.get(stream.eventName) ?? new Set<EventStream>();
    this.streams.set(stream.eventName, streams);
    streams.add(stream);
    this.openCount += 1;
    stream.onClose(() => {
      streams.delete(stream);
      this.openCount -= 1;
    });
  }

  /** Deliver an occurrence this process published to its streams, and relay it to the other processes. */
  async publish(buffered: BufferedEvent): Promise<void> {
    await this.deliver(buffered);
    const { storage } = this.options;
    if (!storage || !this.isRelayed) return;
    const { occurrence, audience, subscriptionId } = buffered;
    const relayed: RelayedOccurrence = { origin: this.nodeId, occurrence, audience, subscriptionId };
    try {
      await storage.publish(EVENT_RELAY_CHANNEL, JSON.stringify(relayed));
    } catch (error) {
      this.logger.warn(`Event "${occurrence.name}" was not relayed to the other processes`, error);
    }
  }

  /** Offer an occurrence to every open stream of its event. */
  private async deliver(buffered: BufferedEvent): Promise<void> {
    const streams = this.streams.get(buffered.occurrence.name);
    if (!streams) return;
    await Promise.all([...streams].map((stream) => stream.offer(buffered)));
  }

  /** Take an occurrence another process published: keep it in this process's buffer and deliver it here. */
  private receive(message: string): void {
    let relayed: RelayedOccurrence;
    try {
      relayed = JSON.parse(message) as RelayedOccurrence;
    } catch {
      return;
    }
    if (relayed.origin === this.nodeId || !relayed.occurrence) return;
    const buffered = this.options.buffer.append(relayed.occurrence, relayed.audience, relayed.subscriptionId);
    this.deliver(buffered).catch((error: unknown) => this.logger.warn('A relayed event was not delivered', error));
  }
}

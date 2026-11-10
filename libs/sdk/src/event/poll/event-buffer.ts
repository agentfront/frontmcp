import type { EventOccurrence } from '@frontmcp/protocol';
import { randomUUID } from '@frontmcp/utils';

import { type EventAudience } from '../../common';

/** A published occurrence as the buffer keeps it, with what decides who may read it. */
export interface BufferedEvent {
  /** Its position: every occurrence the server publishes gets the next one. */
  sequence: number;
  /** When it was published, in Unix milliseconds. */
  publishedAt: number;
  occurrence: EventOccurrence;
  audience?: EventAudience;
  /** Set by a targeted publish: only that subscription reads it. */
  subscriptionId?: string;
}

export interface EventBufferOptions {
  /** `events.buffer.maxAgeMs`. */
  maxAgeMs: number;
  /** `events.buffer.maxEvents`, per event. */
  maxEvents: number;
}

/** What a read from a cursor gives: the occurrences after it that are still kept, in order. */
export interface EventBufferRead {
  events: BufferedEvent[];
  /** True when occurrences after the cursor are gone, or the cursor is not one of this process. */
  truncated: boolean;
}

interface EventRing {
  events: BufferedEvent[];
  /** The position of the newest occurrence this ring dropped. */
  droppedThrough: number;
}

const CURSOR_SEPARATOR = '.';

/**
 * The recent occurrences of each event, kept in memory for `events/poll`. A cursor is `<bootId>.<sequence>`: it names
 * a position in this process only, so after a restart every cursor reads as a gap.
 */
export class EventBuffer {
  private readonly bootId: string;
  private readonly rings = new Map<string, EventRing>();
  private sequence = 0;

  constructor(private readonly options: EventBufferOptions) {
    this.bootId = randomUUID().replace(/-/g, '');
  }

  /** Keep a published occurrence, and drop what its event's ring no longer holds. */
  append(occurrence: EventOccurrence, audience?: EventAudience, subscriptionId?: string): BufferedEvent {
    const now = Date.now();
    this.sequence += 1;
    const buffered: BufferedEvent = { sequence: this.sequence, publishedAt: now, occurrence, audience, subscriptionId };
    const ring = this.ringOf(occurrence.name);
    ring.events.push(buffered);
    this.prune(ring, now);
    return buffered;
  }

  /** The cursor of the current position: a later read from it gives what is published from now on. */
  currentCursor(): string {
    return this.cursorAt(this.sequence);
  }

  /** The cursor of a position: a read from it gives the occurrences after that position. */
  cursorAt(sequence: number): string {
    return `${this.bootId}${CURSOR_SEPARATOR}${sequence}`;
  }

  /** The occurrences of an event after a cursor. A cursor this process cannot place reads as a gap, from now. */
  read(eventName: string, cursor: string): EventBufferRead {
    const ring = this.ringOf(eventName);
    this.prune(ring, Date.now());
    const position = this.positionOf(cursor);
    if (position === undefined) return { events: [], truncated: true };
    return {
      events: ring.events.filter((buffered) => buffered.sequence > position),
      truncated: position < ring.droppedThrough,
    };
  }

  /** The position a cursor names, when this process issued a cursor of that shape and has reached it. */
  private positionOf(cursor: string): number | undefined {
    const [bootId, position, ...rest] = cursor.split(CURSOR_SEPARATOR);
    const sequence = Number(position);
    const isPosition = Number.isSafeInteger(sequence) && sequence >= 0 && String(sequence) === position;
    if (bootId !== this.bootId || !isPosition || rest.length > 0 || sequence > this.sequence) return undefined;
    return sequence;
  }

  /** The ring of an event, made on first use. */
  private ringOf(eventName: string): EventRing {
    let ring = this.rings.get(eventName);
    if (!ring) {
      ring = { events: [], droppedThrough: 0 };
      this.rings.set(eventName, ring);
    }
    return ring;
  }

  /** Drop the occurrences that are too old or too many, remembering how far the ring was cut. */
  private prune(ring: EventRing, now: number): void {
    const { maxAgeMs, maxEvents } = this.options;
    const oldestKept = now - maxAgeMs;
    let dropCount = Math.max(0, ring.events.length - maxEvents);
    while (dropCount < ring.events.length && ring.events[dropCount].publishedAt < oldestKept) dropCount += 1;
    if (dropCount === 0) return;
    ring.droppedThrough = ring.events[dropCount - 1].sequence;
    ring.events.splice(0, dropCount);
  }
}

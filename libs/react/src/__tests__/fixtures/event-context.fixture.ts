/** An `@Event` class of a browser server, declared with what `@frontmcp/react` exports alone. */
import {
  create,
  Event,
  EventContext,
  z,
  type EventCheckItem,
  type EventCheckLimits,
  type EventCheckResult,
  type EventOccurrenceOf,
  type EventSubscriber,
  type EventSubscriptionRef,
  type EventUnsubscribeReason,
} from '../../index';

interface NoteArgs {
  author: string;
}

interface NotePayload {
  author: string;
  text: string;
}

@Event({
  name: 'note.added',
  inputSchema: { author: z.string() },
  payloadSchema: { author: z.string(), text: z.string() },
})
export class NoteAdded extends EventContext<NoteArgs, NotePayload> {
  override authorize(args: NoteArgs, subscriber: EventSubscriber): void {
    if (args.author !== subscriber.sub) throw new Error('Subscribe to your own notes');
  }

  override match(noteEvent: EventOccurrenceOf<NotePayload>, args: NoteArgs): boolean {
    return noteEvent.data.author === args.author;
  }

  override check(_args: NoteArgs, cursor: string | null, limits?: EventCheckLimits): EventCheckResult<NotePayload> {
    const found: EventCheckItem<NotePayload>[] = [];
    return { events: found.slice(0, limits?.maxEvents), cursor };
  }

  override onSubscribe(_args: NoteArgs, subscription: EventSubscriptionRef): void {
    this.logger.info(`subscribed: ${subscription.id}`);
  }

  override onUnsubscribe(_args: NoteArgs, subscription: EventSubscriptionRef, reason: EventUnsubscribeReason): void {
    this.logger.info(`unsubscribed: ${subscription.id} (${reason})`);
  }
}

export const server = create({ info: { name: 'page', version: '1.0.0' }, eventDefinitions: [NoteAdded] });

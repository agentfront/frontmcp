import { internalZ as z } from '@frontmcp/lazy-zod';
import {
  EventDeliveryModeSchema,
  ListEventsRequestSchema,
  ListEventsResultSchema,
  type EventDefinition,
} from '@frontmcp/protocol';

import { EventEntry, Flow, FlowBase, FlowHooksOf, type FlowPlan, type FlowRunOptions } from '../../common';
import { callSurfaceOf, isOfferedOnSurface } from '../../common/availability';
import { encodeOffsetCursor, parseOffsetCursor } from '../../common/utils/offset-cursor.utils';
import { InvalidInputError } from '../../errors';
import { isListedByAuthorities } from '../../surface/entry-authorized';

/** `events/list` answers in pages of this many events, as `tools/list` does by default. */
export const EVENTS_LIST_PAGE_SIZE = 40;

const inputSchema = z.object({
  request: ListEventsRequestSchema,
  ctx: z.unknown(),
});

const outputSchema = ListEventsResultSchema;

const stateSchema = z.object({
  cursor: z.string().optional(),
  authInfo: z.any() as z.ZodType<Record<string, unknown>>,
  events: z.array(
    z.object({
      event: z.instanceof(EventEntry),
      delivery: z.array(EventDeliveryModeSchema),
    }),
  ),
});

const plan = {
  pre: ['parseInput'],
  execute: ['findEvents', 'filterByAvailability', 'filterByAuthorities', 'filterByDiscovery'],
  post: ['parseEvents'],
  finalize: ['finalize'],
} as const satisfies FlowPlan<string>;

declare global {
  interface ExtendFlows {
    'events:list': FlowRunOptions<
      ListEventsFlow,
      typeof plan,
      typeof inputSchema,
      typeof outputSchema,
      typeof stateSchema
    >;
  }
}

const name = 'events:list' as const;
const { Stage } = FlowHooksOf<'events:list'>(name);

/** Orders served events by name, so pages are stable. */
function compareByName(left: { event: EventEntry }, right: { event: EventEntry }): number {
  if (left.event.name < right.event.name) return -1;
  return left.event.name > right.event.name ? 1 : 0;
}

/** Answers `events/list`: the discoverable events offered to the caller and their delivery modes, by page. */
@Flow({
  name,
  plan,
  inputSchema,
  outputSchema,
  access: 'authorized',
})
export default class ListEventsFlow extends FlowBase<typeof name> {
  logger = this.scopeLogger.child('ListEventsFlow');

  /** Reads the cursor and the caller the listing is for. */
  @Stage('parseInput')
  async parseInput() {
    const { request, ctx } = this.input;
    const authInfo = (ctx as { authInfo?: Record<string, unknown> } | undefined)?.authInfo ?? {};
    this.state.set({ cursor: request.params?.cursor ?? undefined, authInfo });
  }

  /** The events offered in at least one delivery mode this server performs. */
  @Stage('findEvents')
  async findEvents() {
    this.state.set('events', this.scope.events?.getServedEvents() ?? []);
  }

  /** Leave out the events `availableWhen.surface` does not offer to the surface this listing is for. */
  @Stage('filterByAvailability')
  async filterByAvailability() {
    const callSurface = callSurfaceOf(this.input.ctx);
    const offered = this.state.required.events.filter(({ event }) =>
      isOfferedOnSurface(event.metadata.availableWhen, callSurface),
    );
    this.state.set('events', offered);
  }

  /** Leave out the events the caller's `authorities` do not allow, and an event whose policy throws. */
  @Stage('filterByAuthorities')
  async filterByAuthorities() {
    const engine = this.scope.authoritiesEngine;
    const contextBuilder = this.scope.authoritiesContextBuilder;
    if (!engine || !contextBuilder) return;

    const { events, authInfo } = this.state.required;
    const answers = await Promise.all(
      events.map(({ event }) => {
        const authorities = event.getAuthorities();
        if (authorities === undefined) return true;
        return isListedByAuthorities(engine, contextBuilder, authorities, authInfo, event.name, this.logger);
      }),
    );
    this.state.set(
      'events',
      events.filter((_item, index) => answers[index]),
    );
  }

  /** Leave out the events declared with `hideFromDiscovery`: a client that knows their name can still subscribe. */
  @Stage('filterByDiscovery')
  async filterByDiscovery() {
    const discoverable = this.state.required.events.filter(({ event }) => !event.metadata.hideFromDiscovery);
    this.state.set('events', discoverable);
  }

  /** Answers one page of definitions, ordered by name, with the cursor of the next page. */
  @Stage('parseEvents')
  async parseEvents() {
    const sorted = [...this.state.required.events].sort(compareByName);
    const offset = this.state.cursor ? parseOffsetCursor(this.state.cursor) : 0;
    if (offset > sorted.length) {
      throw new InvalidInputError(
        `Invalid pagination cursor: offset ${offset} exceeds total event count ${sorted.length}`,
      );
    }

    const events: EventDefinition[] = sorted
      .slice(offset, offset + EVENTS_LIST_PAGE_SIZE)
      .map(({ event, delivery }) => ({
        name: event.name,
        ...(event.metadata.description && { description: event.metadata.description }),
        delivery,
        inputSchema: event.getInputJsonSchema(),
        payloadSchema: event.getPayloadJsonSchema(),
      }));

    const nextOffset = offset + EVENTS_LIST_PAGE_SIZE;
    this.respond({ events, ...(nextOffset < sorted.length && { nextCursor: encodeOffsetCursor(nextOffset) }) });
  }

  /** Runs after a success or a failure, so hooks that must see both attach here. */
  @Stage('finalize')
  async finalize() {
    this.logger.verbose('finalize');
  }
}

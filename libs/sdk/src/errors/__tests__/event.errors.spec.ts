import { EVENTS_ERROR_CODES, EVENTS_SKETCH_ERROR_CODES } from '@frontmcp/protocol';

import { toSdkMcpError } from '../../transport/mcp-handlers/mcp-error.utils';
import {
  EventCallbackEndpointError,
  EventForbiddenError,
  EventNotFoundError,
  EventProtocolError,
  EventPublishEndpointError,
  EventResourceExhaustedError,
  EventSubscriptionStoreError,
  EventUnsupportedError,
} from '../event.errors';
import { InternalMcpError, PublicMcpError } from '../mcp.error';

describe('events protocol errors', () => {
  it.each([
    ['SEP-3415', EVENTS_ERROR_CODES, [-32023, -32024, -32025, -32026, -32027]],
    ['the design sketch', EVENTS_SKETCH_ERROR_CODES, [-32011, -32012, -32013, -32014, -32015]],
  ])('carry the JSON-RPC codes of %s', (_label, codes, expected) => {
    const errors = [
      new EventNotFoundError(codes, 'event', 'order.created'),
      new EventForbiddenError(codes, 'order.created', 'policy denied'),
      new EventResourceExhaustedError(codes, 'subscriptions', 100),
      new EventUnsupportedError(codes, 'deliveryMode', 'push', ['webhook']),
      new EventCallbackEndpointError(codes, 'challenge_failed'),
    ];

    expect(errors.map((error) => error.toJsonRpcError().code)).toEqual(expected);
    for (const error of errors) {
      expect(error).toBeInstanceOf(EventProtocolError);
      expect(error).toBeInstanceOf(PublicMcpError);
    }
  });

  it('says which kind of thing was not found', () => {
    expect(new EventNotFoundError(EVENTS_ERROR_CODES, 'event', 'order.created').toJsonRpcError()).toEqual({
      code: -32023,
      message: 'Event "order.created" is not served. Call events/list for the events this server offers.',
      data: { kind: 'event', name: 'order.created' },
    });
    expect(new EventNotFoundError(EVENTS_ERROR_CODES, 'subscription', 'order.created').toJsonRpcError()).toEqual({
      code: -32023,
      message: 'No subscription to "order.created" was found. Call events/list for the events this server offers.',
      data: { kind: 'subscription', name: 'order.created' },
    });
  });

  it('gives the reason a subscription is forbidden', () => {
    expect(new EventForbiddenError(EVENTS_ERROR_CODES, 'audit.logged', 'policy denied').toJsonRpcError()).toEqual({
      code: -32024,
      message: 'Subscribing to "audit.logged" is not allowed: policy denied',
      data: { reason: 'policy denied' },
    });
  });

  it('names the limit that was reached, its ceiling and what frees a place', () => {
    expect(new EventResourceExhaustedError(EVENTS_ERROR_CODES, 'subscriptions', 100).toJsonRpcError()).toEqual({
      code: -32025,
      message:
        'The limit of 100 webhook subscriptions per caller is reached. Remove one with events/unsubscribe, then retry.',
      data: { limit: 'subscriptions', max: 100 },
    });
    expect(new EventResourceExhaustedError(EVENTS_ERROR_CODES, 'pollLeases', 100, 330_000).toJsonRpcError()).toEqual({
      code: -32025,
      message:
        'The limit of 100 poll leases per caller is reached. A lease ends 6 minutes after the last events/poll of ' +
        'its subscription: stop polling one, and retry after that.',
      data: { limit: 'pollLeases', max: 100 },
    });
    expect(new EventResourceExhaustedError(EVENTS_ERROR_CODES, 'streams', 100).toJsonRpcError()).toEqual({
      code: -32025,
      message: 'The limit of 100 open event streams per caller is reached. Close one, then retry.',
      data: { limit: 'streams', max: 100 },
    });
    expect(new EventResourceExhaustedError(EVENTS_ERROR_CODES, 'verifications', 10).toJsonRpcError()).toEqual({
      code: -32025,
      message: 'The callback host was sent 10 verification requests in the last minute. Retry in a minute.',
      data: { limit: 'verifications', max: 10 },
    });
  });

  it('names the unsupported feature, its value and what is supported', () => {
    expect(new EventUnsupportedError(EVENTS_ERROR_CODES, 'deliveryMode', 'push', ['webhook']).toJsonRpcError()).toEqual(
      {
        code: -32026,
        message: '"push" is not a supported deliveryMode. Supported: webhook.',
        data: { feature: 'deliveryMode', value: 'push', supported: ['webhook'] },
      },
    );
    expect(new EventUnsupportedError(EVENTS_ERROR_CODES, 'deliveryMode', 'webhook', []).getPublicMessage()).toBe(
      '"webhook" is not a supported deliveryMode. Supported: none.',
    );
  });

  it('tells the category of a callback failure and nothing else', () => {
    expect(new EventCallbackEndpointError(EVENTS_ERROR_CODES, 'http_5xx').toJsonRpcError()).toEqual({
      code: -32027,
      message:
        'The callback endpoint could not be verified (http_5xx). It must answer the verification request with 2xx ' +
        'and the challenge it received.',
      data: { reason: 'http_5xx' },
    });
  });

  it('reach a client with their code and data', () => {
    const sent = toSdkMcpError(new EventForbiddenError(EVENTS_SKETCH_ERROR_CODES, 'audit.logged', 'policy denied'));

    expect(sent.code).toBe(-32012);
    expect(sent.data).toMatchObject({ reason: 'policy denied' });
  });

  it('report a publish endpoint that cannot be served as an internal error', () => {
    const error = new EventPublishEndpointError('events.publishEndpoint.path "/mcp" is reserved');

    expect(error).toBeInstanceOf(InternalMcpError);
    expect(error.code).toBe('EVENT_PUBLISH_ENDPOINT');
    expect(error.message).toBe('Event publish endpoint: events.publishEndpoint.path "/mcp" is reserved');
  });

  it('report a store problem as an internal error', () => {
    const error = new EventSubscriptionStoreError('the sqlite store cannot be opened: no such directory');

    expect(error).toBeInstanceOf(InternalMcpError);
    expect(error.code).toBe('EVENT_SUBSCRIPTION_STORE');
    expect(error.message).toBe('Event subscription store: the sqlite store cannot be opened: no such directory');
  });
});

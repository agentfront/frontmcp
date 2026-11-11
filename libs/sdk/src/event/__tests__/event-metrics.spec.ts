import { createEventMetrics, EVENT_COUNTERS } from '../delivery/event-metrics';

describe('createEventMetrics', () => {
  it('counts nothing, and loads nothing, while /metrics is off', () => {
    const loadFactory = jest.fn();

    createEventMetrics(undefined, loadFactory).count('published', 'order.created');
    createEventMetrics({ enabled: false }, loadFactory).count('delivered', 'order.created', 3);

    expect(loadFactory).not.toHaveBeenCalled();
  });

  it('adds to the named counter, labelled with the event, when /metrics is on', () => {
    const inc = jest.fn();
    const createCounter = jest.fn().mockReturnValue({ inc });
    const metrics = createEventMetrics({ enabled: true }, () => createCounter);

    metrics.count('published', 'order.created');
    metrics.count('matched', 'order.created', 4);

    expect(createCounter).toHaveBeenNthCalledWith(1, 'frontmcp_events_published_total', 'Events published');
    expect(createCounter).toHaveBeenNthCalledWith(
      2,
      'frontmcp_events_matched_total',
      'Deliveries queued for the subscriptions an event matched',
    );
    expect(inc).toHaveBeenNthCalledWith(1, 1, { event: 'order.created' });
    expect(inc).toHaveBeenNthCalledWith(2, 4, { event: 'order.created' });
  });

  it('names one counter for each thing that happens to an event', () => {
    expect(Object.keys(EVENT_COUNTERS)).toEqual([
      'published',
      'matched',
      'delivered',
      'retried',
      'abandoned',
      'dropped',
      'suspended',
      'terminated',
      'notified',
    ]);
  });

  it('records through @frontmcp/observability by default', () => {
    const metrics = createEventMetrics({ enabled: true });

    expect(() => metrics.count('published', 'order.created')).not.toThrow();
  });
});

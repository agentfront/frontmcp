import { InternalMcpError } from '@frontmcp/sdk';

import type { DevEventSink } from '../dev-events/dev-event-stream';
import { ObservabilityConfigurationError } from '../plugin/observability.errors';
import { resolveDevEventsOptions, resolveStallOptions } from '../plugin/observability.options';
import ObservabilityPlugin from '../plugin/observability.plugin';

const sink: DevEventSink = { write: () => undefined };

describe('resolveStallOptions', () => {
  it('is off unless asked for, and defaults the threshold to 200 ms', () => {
    expect(resolveStallOptions(undefined)).toBe(false);
    expect(resolveStallOptions(false)).toBe(false);
    expect(resolveStallOptions(true)).toEqual({ thresholdMs: 200 });
    expect(resolveStallOptions({ thresholdMs: 50 })).toEqual({ thresholdMs: 50 });
  });

  it.each([
    [{ thresholdMs: 5 }, 'stalls.thresholdMs: must be a whole number of milliseconds from 20 to 60000'],
    [{ thresholdMs: 1.5 }, 'stalls.thresholdMs: must be a whole number of milliseconds from 20 to 60000'],
    [{ threshold: 100 }, 'stalls: Unrecognized key: "threshold"'],
  ])('refuses %j with a configuration error', (input, message) => {
    const attempt = () => resolveStallOptions(input as never);

    expect(attempt).toThrow(ObservabilityConfigurationError);
    expect(attempt).toThrow(InternalMcpError);
    expect(attempt).toThrow(`Invalid ObservabilityPlugin options: ${message}`);
  });
});

describe('ObservabilityPlugin.init', () => {
  it('fails at once on stall or dev event options it cannot honour', () => {
    expect(() => ObservabilityPlugin.init({ stalls: { thresholdMs: 5 } })).toThrow(ObservabilityConfigurationError);
    expect(() => ObservabilityPlugin.init({ devEvents: { maxQueue: -1 } })).toThrow(ObservabilityConfigurationError);
  });
});

describe('resolveDevEventsOptions', () => {
  const underFrontmcpDev = { FRONTMCP_DEV_EVENTS_FILE: '/work/.frontmcp/dev-events.jsonl' };

  it('writes the file frontmcp dev names, with a 1000-event queue', () => {
    expect(resolveDevEventsOptions(undefined, underFrontmcpDev)).toEqual({
      file: '/work/.frontmcp/dev-events.jsonl',
      ipc: false,
      sinks: [],
      maxQueue: 1000,
    });
  });

  it('sends the events to the dev parent when frontmcp dev asks for IPC', () => {
    expect(resolveDevEventsOptions(true, { FRONTMCP_DEV_EVENTS_IPC: '1' })).toEqual({
      ipc: true,
      sinks: [],
      maxQueue: 1000,
    });
  });

  it('takes a file, sinks and a queue bound from the options in development', () => {
    expect(
      resolveDevEventsOptions({ file: 'events.jsonl', sinks: [sink], maxQueue: 10 }, { NODE_ENV: 'development' }),
    ).toEqual({ file: 'events.jsonl', ipc: false, sinks: [sink], maxQueue: 10 });
  });

  it('is off outside development, off when turned off, and off with nowhere to write', () => {
    expect(resolveDevEventsOptions({ sinks: [sink] }, { NODE_ENV: 'production' })).toBe(false);
    expect(resolveDevEventsOptions(false, underFrontmcpDev)).toBe(false);
    expect(resolveDevEventsOptions(true, { NODE_ENV: 'development' })).toBe(false);
  });

  it.each([
    [{ sinks: [{}] }, 'devEvents.sinks.0: must be a sink: an object with a write(events) method'],
    [{ file: '' }, 'devEvents.file: must be a file path'],
    [{ maxQueue: 0 }, 'devEvents.maxQueue: must be a whole number from 1 to 100000'],
  ])('refuses %j with a configuration error', (input, message) => {
    expect(() => resolveDevEventsOptions(input as never, underFrontmcpDev)).toThrow(
      new ObservabilityConfigurationError(`Invalid ObservabilityPlugin options: ${message}`),
    );
  });
});

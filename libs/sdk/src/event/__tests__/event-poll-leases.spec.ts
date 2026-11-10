import { getRuntimeContext } from '@frontmcp/utils';

import { type EventContext, type EventSubscriptionRef } from '../../common';
import {
  EventPollLeases,
  MAX_POLL_LEASES,
  POLL_LEASE_SWEEP_INTERVAL_MS,
  pollLeaseMs,
  type PollLeaseRequest,
} from '../poll/event-poll-leases';

jest.mock('@frontmcp/utils', () => {
  const actual = jest.requireActual('@frontmcp/utils');
  return { ...actual, getRuntimeContext: jest.fn(actual.getRuntimeContext) };
});

const NOW = 1_800_000_000_000;
const LEASE_MS = 300_000;

function subscriptionRef(id: string): EventSubscriptionRef {
  return {
    id,
    name: 'order.created',
    mode: 'poll',
    subscriber: { sub: 'ada', roles: [], permissions: [], scopes: [], claims: {} },
  };
}

function harness(maxPerPrincipal = 100) {
  const onSubscribe = jest.fn();
  const onUnsubscribe = jest.fn();
  const warn = jest.fn();
  const leases = new EventPollLeases({ maxPerPrincipal, logger: { child: () => ({ warn }) } as never });
  const context = { onSubscribe, onUnsubscribe } as unknown as EventContext;
  const request = (id: string, overrides: Partial<PollLeaseRequest> = {}): PollLeaseRequest => ({
    subscription: subscriptionRef(id),
    arguments: { status: 'paid' },
    principalKey: 'principal:ada',
    leaseMs: LEASE_MS,
    context,
    ...overrides,
  });
  return { leases, onSubscribe, onUnsubscribe, warn, request };
}

describe('pollLeaseMs', () => {
  it('lasts five poll intervals, and at least five minutes', () => {
    expect(pollLeaseMs(30_000)).toBe(300_000);
    expect(pollLeaseMs(1000)).toBe(300_000);
    expect(pollLeaseMs(120_000)).toBe(600_000);
  });
});

describe('EventPollLeases', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.mocked(getRuntimeContext).mockReset();
    jest.mocked(getRuntimeContext).mockImplementation(jest.requireActual('@frontmcp/utils').getRuntimeContext);
  });

  it('calls onSubscribe at the first poll of a subscription, and not at the next ones', async () => {
    const { leases, onSubscribe, request } = harness();

    await leases.renew(request('sub_1'));
    await leases.renew(request('sub_1'));
    await leases.renew(request('sub_2'));

    expect(onSubscribe).toHaveBeenCalledTimes(2);
    expect(onSubscribe).toHaveBeenNthCalledWith(1, { status: 'paid' }, subscriptionRef('sub_1'));
    expect(leases.size).toBe(2);
    expect(leases.has('sub_1')).toBe(true);
    expect(leases.has('sub_3')).toBe(false);
  });

  it('starts no lease when onSubscribe throws', async () => {
    const { leases, onSubscribe, request } = harness();
    onSubscribe.mockRejectedValueOnce(new Error('upstream'));

    await expect(leases.renew(request('sub_1'))).rejects.toThrow('upstream');

    expect(leases.has('sub_1')).toBe(false);
  });

  it('ends a lease no poll renewed in time, telling the event once', async () => {
    const { leases, onUnsubscribe, request } = harness();
    await leases.renew(request('sub_1'));
    await leases.renew(request('sub_2'));

    jest.setSystemTime(NOW + LEASE_MS - 1);
    await leases.renew(request('sub_2'));
    await leases.sweep();
    expect(onUnsubscribe).not.toHaveBeenCalled();

    jest.setSystemTime(NOW + LEASE_MS);
    await leases.sweep();
    await leases.sweep();

    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
    expect(onUnsubscribe).toHaveBeenCalledWith({ status: 'paid' }, subscriptionRef('sub_1'), 'expired');
    expect(leases.has('sub_2')).toBe(true);
  });

  it('starts a subscription again when it polls after its lease ended', async () => {
    const { leases, onSubscribe, request } = harness();
    await leases.renew(request('sub_1'));
    jest.setSystemTime(NOW + LEASE_MS);
    await leases.sweep();

    await leases.renew(request('sub_1'));

    expect(onSubscribe).toHaveBeenCalledTimes(2);
  });

  it('logs an onUnsubscribe that throws, and ends the other leases', async () => {
    const { leases, onUnsubscribe, warn, request } = harness();
    const failure = new Error('upstream');
    onUnsubscribe.mockRejectedValueOnce(failure);
    await leases.renew(request('sub_1'));
    await leases.renew(request('sub_2'));

    await leases.sweep(NOW + LEASE_MS);

    expect(onUnsubscribe).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'onUnsubscribe of event "order.created" failed for poll subscription sub_1',
      failure,
    );
    expect(leases.size).toBe(0);
  });

  it('keeps a lease for an event that has only one of the two methods', async () => {
    const { leases, request } = harness();
    const context = { onSubscribe: jest.fn() } as unknown as EventContext;

    await leases.renew(request('sub_1', { context }));
    await expect(leases.sweep(NOW + LEASE_MS)).resolves.toBeUndefined();

    expect(leases.size).toBe(0);
  });

  it('is full for an owner at maxPerPrincipal, and never for anonymous callers below the process limit', async () => {
    const { leases, request } = harness(2);
    await leases.renew(request('sub_1'));
    expect(leases.isFull('principal:ada')).toBe(false);

    await leases.renew(request('sub_2'));
    await leases.renew(request('sub_3', { principalKey: undefined }));

    expect(leases.isFull('principal:ada')).toBe(true);
    expect(leases.isFull('principal:bob')).toBe(false);
    expect(leases.isFull(undefined)).toBe(false);
  });

  it('is full for everyone at the process limit', async () => {
    const { leases, request } = harness(MAX_POLL_LEASES * 2);
    const context = {} as EventContext;
    for (let index = 0; index < MAX_POLL_LEASES; index++) {
      await leases.renew(request(`sub_${index}`, { principalKey: undefined, context }));
    }

    expect(leases.isFull(undefined)).toBe(true);
    expect(leases.isFull('principal:ada')).toBe(true);
  });

  it('sweeps when a poll renews and the last sweep is a minute old', async () => {
    const { leases, onUnsubscribe, request } = harness();
    await leases.renew(request('sub_1', { leaseMs: 1000 }));

    jest.setSystemTime(NOW + POLL_LEASE_SWEEP_INTERVAL_MS);
    await leases.renew(request('sub_2'));
    await jest.advanceTimersByTimeAsync(0);

    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sweeps on a timer in a long-lived process, until it is stopped', async () => {
    const { leases, onUnsubscribe, request } = harness();
    leases.start();
    await leases.renew(request('sub_1', { leaseMs: 1000 }));

    await jest.advanceTimersByTimeAsync(POLL_LEASE_SWEEP_INTERVAL_MS);
    expect(onUnsubscribe).toHaveBeenCalledTimes(1);

    await leases.renew(request('sub_2', { leaseMs: 1000 }));
    leases.stop();
    await jest.advanceTimersByTimeAsync(POLL_LEASE_SWEEP_INTERVAL_MS * 2);

    expect(onUnsubscribe).toHaveBeenCalledTimes(1);
    expect(leases.size).toBe(0);
  });

  it.each([
    ['a serverless deployment', { runtime: 'node', deployment: 'serverless' }],
    ['an edge runtime', { runtime: 'edge', deployment: 'standalone' }],
    ['a browser', { runtime: 'browser', deployment: 'standalone' }],
  ])('starts no timer in %s', (_label, runtimeContext) => {
    jest.mocked(getRuntimeContext).mockReturnValue(runtimeContext as never);
    const { leases } = harness();

    leases.start();

    expect(jest.getTimerCount()).toBe(0);
    leases.stop();
  });

  it('logs a sweep that fails', async () => {
    const { leases, warn, request } = harness();
    await leases.renew(request('sub_1'));
    const failure = new Error('sweep failed');
    jest.spyOn(leases, 'sweep').mockRejectedValueOnce(failure);

    jest.setSystemTime(NOW + POLL_LEASE_SWEEP_INTERVAL_MS);
    await leases.renew(request('sub_1'));
    await jest.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalledWith('The poll lease sweep failed', failure);
  });
});

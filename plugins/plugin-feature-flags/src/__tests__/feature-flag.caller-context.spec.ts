/**
 * The list filters and the execution gates must evaluate flags for the CALLER
 * (GHSA-gf7p-j3hr-h5h4).
 *
 * Both paths used to call the adapter with `{}`. "Is this flag on for nobody in particular"
 * is a different question from "is it on for THIS caller", and a targeted adapter can answer
 * them differently -- so an empty context could open a gate the caller's own context closes.
 */
import { FrontMcpContextStorage, type FrontMcpContext } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import { buildFeatureFlagContext } from '../feature-flag.context';
import FeatureFlagPlugin from '../feature-flag.plugin';
import { FeatureFlagAdapterToken } from '../feature-flag.symbols';
import type { FeatureFlagPluginOptionsInput } from '../feature-flag.types';

function createAdapter(): FeatureFlagAdapter {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    isEnabled: jest.fn().mockResolvedValue(true),
    getVariant: jest.fn().mockResolvedValue({ name: 'on', value: undefined, enabled: true }),
    evaluateFlags: jest.fn().mockResolvedValue(new Map([['flag-a', true]])),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

const caller = {
  sessionId: 'session-1',
  authInfo: { clientId: 'client-1', extra: { sub: 'user-1' } },
} as unknown as FrontMcpContext;

function createPlugin(
  store: FrontMcpContext | undefined,
  options: FeatureFlagPluginOptionsInput = { adapter: 'static', flags: {} },
) {
  const adapter = createAdapter();
  const plugin = new FeatureFlagPlugin(options);
  const resolve = (token: unknown): unknown => {
    if (token === FeatureFlagAdapterToken) return adapter;
    if (token === FrontMcpContextStorage) return { getStore: () => store };
    return undefined;
  };
  (plugin as unknown as { get: (token: unknown) => unknown }).get = resolve;
  return { plugin, adapter };
}

const gateCtx = { state: { tool: { metadata: { name: 'a', featureFlag: 'flag-a' } } } } as never;

describe('FeatureFlagPlugin — caller context (GHSA-gf7p-j3hr-h5h4)', () => {
  it('evaluates the gate with the caller identity, not an empty context', async () => {
    const { plugin, adapter } = createPlugin(caller);

    await plugin.gateToolExecution(gateCtx);

    expect(adapter.evaluateFlags).toHaveBeenCalledWith(['flag-a'], {
      userId: 'user-1',
      sessionId: 'session-1',
      attributes: {},
    });
  });

  it('honours userIdResolver and attributesResolver', async () => {
    const { plugin, adapter } = createPlugin(caller, {
      adapter: 'static',
      flags: {},
      userIdResolver: (ctx) => `tenant:${ctx.authInfo?.clientId}`,
      attributesResolver: () => ({ plan: 'enterprise' }),
    });

    await plugin.gateToolExecution(gateCtx);

    expect(adapter.evaluateFlags).toHaveBeenCalledWith(['flag-a'], {
      userId: 'tenant:client-1',
      sessionId: 'session-1',
      attributes: { plan: 'enterprise' },
    });
  });

  it('falls back to an empty context outside a request', async () => {
    const { plugin, adapter } = createPlugin(undefined);

    await plugin.gateToolExecution(gateCtx);

    expect(adapter.evaluateFlags).toHaveBeenCalledWith(['flag-a'], {});
  });

  it('falls back to an empty context when context storage is unavailable', async () => {
    const adapter = createAdapter();
    const plugin = new FeatureFlagPlugin({ adapter: 'static', flags: {} });
    (plugin as unknown as { get: (token: unknown) => unknown }).get = (token: unknown) => {
      if (token === FeatureFlagAdapterToken) return adapter;
      throw new Error('provider not registered');
    };

    await plugin.gateToolExecution(gateCtx);

    expect(adapter.evaluateFlags).toHaveBeenCalledWith(['flag-a'], {});
  });

  describe('buildFeatureFlagContext', () => {
    it('returns an empty context when there is no request context', () => {
      expect(buildFeatureFlagContext(undefined, {})).toEqual({});
    });

    it('prefers sub, then userId, then clientId', () => {
      const withUserId = { sessionId: 's', authInfo: { clientId: 'c', extra: { userId: 'u' } } };
      const withClientId = { sessionId: 's', authInfo: { clientId: 'c', extra: {} } };

      expect(buildFeatureFlagContext(caller, {}).userId).toBe('user-1');
      expect(buildFeatureFlagContext(withUserId as unknown as FrontMcpContext, {}).userId).toBe('u');
      expect(buildFeatureFlagContext(withClientId as unknown as FrontMcpContext, {}).userId).toBe('c');
    });

    it('leaves userId undefined for an unauthenticated caller', () => {
      const anonymous = { sessionId: 's' } as unknown as FrontMcpContext;

      expect(buildFeatureFlagContext(anonymous, {})).toEqual({
        userId: undefined,
        sessionId: 's',
        attributes: {},
      });
    });
  });
});

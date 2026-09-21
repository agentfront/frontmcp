/**
 * A feature-flagged resource or prompt is refused on direct access, not merely hidden from
 * the listing (GHSA-gf7p-j3hr-h5h4).
 *
 * The plugin filtered `tools/list`, `resources/list`, `prompts/list` and `skills/search`, and
 * gated `tools/call` — `gateToolExecution` even says why: "This prevents bypassing the list
 * filter via direct tool invocation."
 *
 * Resources and prompts had no such gate. `resources/read` on a known URI and
 * `prompts/get` on a known name both ran regardless of the flag, so a flag only removed them
 * from the menu. Nothing about a capability being absent from a listing stops a client naming
 * it, and clients cache listings and hold URIs from earlier sessions without any malice at
 * all.
 */
import type { FeatureFlagAdapter } from '../adapters/feature-flag-adapter.interface';
import FeatureFlagPlugin from '../feature-flag.plugin';

describe('FeatureFlagPlugin — direct access gates (GHSA-gf7p-j3hr-h5h4)', () => {
  let plugin: FeatureFlagPlugin;
  let mockAdapter: FeatureFlagAdapter;

  beforeEach(() => {
    mockAdapter = {
      initialize: jest.fn().mockResolvedValue(undefined),
      isEnabled: jest.fn().mockResolvedValue(false),
      getVariant: jest.fn().mockResolvedValue({ name: 'off', value: undefined, enabled: false }),
      evaluateFlags: jest.fn().mockResolvedValue(new Map()),
      destroy: jest.fn().mockResolvedValue(undefined),
    };

    plugin = new FeatureFlagPlugin({ adapter: 'static', flags: {} });
    (plugin as any).get = jest.fn().mockReturnValue(mockAdapter);
  });

  describe('gateResourceRead', () => {
    it('refuses a resource whose flag is off', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', false]]));
      const flowCtx = {
        state: { resource: { metadata: { name: 'billing-report', featureFlag: 'flag-a' } } },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).rejects.toThrow(/disabled by feature flag "flag-a"/);
    });

    it('allows a resource whose flag is on', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', true]]));
      const flowCtx = {
        state: { resource: { metadata: { name: 'billing-report', featureFlag: 'flag-a' } } },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).resolves.toBeUndefined();
    });

    it('allows a resource with no flag', async () => {
      const flowCtx = { state: { resource: { metadata: { name: 'public-doc' } } } } as any;

      await expect(plugin.gateResourceRead(flowCtx)).resolves.toBeUndefined();
      expect(mockAdapter.evaluateFlags).not.toHaveBeenCalled();
    });

    it('falls back to the ref default when the adapter throws', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockRejectedValue(new Error('adapter down'));
      const flowCtx = {
        state: {
          resource: { metadata: { name: 'billing-report', featureFlag: { key: 'flag-a', defaultValue: true } } },
        },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).resolves.toBeUndefined();
    });

    it('fails closed when the adapter throws and the ref has no default', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockRejectedValue(new Error('adapter down'));
      const flowCtx = {
        state: { resource: { metadata: { name: 'billing-report', featureFlag: 'flag-a' } } },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).rejects.toThrow(/disabled by feature flag/);
    });
  });

  describe('listing agrees with the execution gate', () => {
    const flaggedTool = (defaultValue: boolean) => [
      { tool: { metadata: { name: 'a', featureFlag: { key: 'flag-a', defaultValue } } } },
    ];

    it('hides an entry the adapter reports as disabled, even with defaultValue: true', async () => {
      // A key PRESENT with `false` is the operator disabling it. `defaultValue` must not
      // override that, or the entry is listed and then refused on access.
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', false]]));
      const tools = flaggedTool(true);
      const flowCtx = { state: { tools, set: jest.fn() } } as never;

      await plugin.filterListTools(flowCtx);

      expect((flowCtx as unknown as { state: { set: jest.Mock } }).state.set).toHaveBeenCalledWith('tools', []);
    });

    it('refuses that same entry at the gate, for the same reason', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', false]]));
      const flowCtx = {
        state: { tool: { metadata: { name: 'a', featureFlag: { key: 'flag-a', defaultValue: true } } } },
      } as never;

      await expect(plugin.gateToolExecution(flowCtx)).rejects.toThrow(/disabled by feature flag/);
    });

    it('applies defaultValue when the adapter OMITS the key, in the list and at the gate', async () => {
      // An absent key means the adapter has never heard of the flag — that is what
      // `defaultValue` is for. The static adapter omits unconfigured keys.
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map());
      const tools = flaggedTool(true);
      const listCtx = { state: { tools, set: jest.fn() } } as never;

      await plugin.filterListTools(listCtx);
      expect((listCtx as unknown as { state: { set: jest.Mock } }).state.set).toHaveBeenCalledWith('tools', tools);

      const gateCtx = {
        state: { tool: { metadata: { name: 'a', featureFlag: { key: 'flag-a', defaultValue: true } } } },
      } as never;
      await expect(plugin.gateToolExecution(gateCtx)).resolves.toBeUndefined();
    });

    it('evaluates the gate with a caller context, not an empty one', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-a', true]]));
      const flowCtx = {
        state: { tool: { metadata: { name: 'a', featureFlag: 'flag-a' } } },
      } as never;

      await plugin.gateToolExecution(flowCtx);

      // Asking "is this on for nobody in particular" is a different question from "is it on
      // for THIS caller"; a targeted adapter can answer them differently.
      expect(mockAdapter.evaluateFlags).toHaveBeenCalledWith(['flag-a'], expect.any(Object));
    });
  });

  describe('gatePromptGet', () => {
    it('refuses a prompt whose flag is off', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-b', false]]));
      const flowCtx = {
        state: { prompt: { metadata: { name: 'internal-review', featureFlag: 'flag-b' } } },
      } as any;

      await expect(plugin.gatePromptGet(flowCtx)).rejects.toThrow(/disabled by feature flag "flag-b"/);
    });

    it('allows a prompt whose flag is on', async () => {
      (mockAdapter.evaluateFlags as jest.Mock).mockResolvedValue(new Map([['flag-b', true]]));
      const flowCtx = {
        state: { prompt: { metadata: { name: 'internal-review', featureFlag: 'flag-b' } } },
      } as any;

      await expect(plugin.gatePromptGet(flowCtx)).resolves.toBeUndefined();
    });

    it('allows a prompt with no flag', async () => {
      const flowCtx = { state: { prompt: { metadata: { name: 'public-prompt' } } } } as any;

      await expect(plugin.gatePromptGet(flowCtx)).resolves.toBeUndefined();
      expect(mockAdapter.evaluateFlags).not.toHaveBeenCalled();
    });
  });
});

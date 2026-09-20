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
      (mockAdapter.isEnabled as jest.Mock).mockResolvedValue(false);
      const flowCtx = {
        state: { resource: { metadata: { name: 'billing-report', featureFlag: 'flag-a' } } },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).rejects.toThrow(/disabled by feature flag "flag-a"/);
    });

    it('allows a resource whose flag is on', async () => {
      (mockAdapter.isEnabled as jest.Mock).mockResolvedValue(true);
      const flowCtx = {
        state: { resource: { metadata: { name: 'billing-report', featureFlag: 'flag-a' } } },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).resolves.toBeUndefined();
    });

    it('allows a resource with no flag', async () => {
      const flowCtx = { state: { resource: { metadata: { name: 'public-doc' } } } } as any;

      await expect(plugin.gateResourceRead(flowCtx)).resolves.toBeUndefined();
      expect(mockAdapter.isEnabled).not.toHaveBeenCalled();
    });

    it('falls back to the ref default when the adapter throws', async () => {
      (mockAdapter.isEnabled as jest.Mock).mockRejectedValue(new Error('adapter down'));
      const flowCtx = {
        state: {
          resource: { metadata: { name: 'billing-report', featureFlag: { key: 'flag-a', defaultValue: true } } },
        },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).resolves.toBeUndefined();
    });

    it('fails closed when the adapter throws and the ref has no default', async () => {
      (mockAdapter.isEnabled as jest.Mock).mockRejectedValue(new Error('adapter down'));
      const flowCtx = {
        state: { resource: { metadata: { name: 'billing-report', featureFlag: 'flag-a' } } },
      } as any;

      await expect(plugin.gateResourceRead(flowCtx)).rejects.toThrow(/disabled by feature flag/);
    });
  });

  describe('gatePromptGet', () => {
    it('refuses a prompt whose flag is off', async () => {
      (mockAdapter.isEnabled as jest.Mock).mockResolvedValue(false);
      const flowCtx = {
        state: { prompt: { metadata: { name: 'internal-review', featureFlag: 'flag-b' } } },
      } as any;

      await expect(plugin.gatePromptGet(flowCtx)).rejects.toThrow(/disabled by feature flag "flag-b"/);
    });

    it('allows a prompt whose flag is on', async () => {
      (mockAdapter.isEnabled as jest.Mock).mockResolvedValue(true);
      const flowCtx = {
        state: { prompt: { metadata: { name: 'internal-review', featureFlag: 'flag-b' } } },
      } as any;

      await expect(plugin.gatePromptGet(flowCtx)).resolves.toBeUndefined();
    });

    it('allows a prompt with no flag', async () => {
      const flowCtx = { state: { prompt: { metadata: { name: 'public-prompt' } } } } as any;

      await expect(plugin.gatePromptGet(flowCtx)).resolves.toBeUndefined();
      expect(mockAdapter.isEnabled).not.toHaveBeenCalled();
    });
  });
});

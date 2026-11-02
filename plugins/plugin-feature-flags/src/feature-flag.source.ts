import type { EnabledSource, ErrorRemedy, FrontMcpContext } from '@frontmcp/sdk';

import type { FeatureFlagAdapter } from './adapters/feature-flag-adapter.interface';
import { buildFeatureFlagContext } from './feature-flag.context';
import type { FeatureFlagPluginOptions, FeatureFlagRef } from './feature-flag.types';

/** The plugin options a flag source reads: how a gate falls back, and how the caller is described to the adapter. */
export type FeatureFlagSourceOptions = Pick<
  FeatureFlagPluginOptions,
  'gateDefaultValue' | 'userIdResolver' | 'attributesResolver'
>;

export function flagKeyOf(ref: FeatureFlagRef): string {
  return typeof ref === 'string' ? ref : ref.key;
}

/**
 * What a gate answers when the adapter throws or does not know the flag: the ref's `defaultValue`, then
 * `gateDefaultValue`, then `false`, so gates fail closed unless one of them opts in.
 */
export function gateFallback(ref: FeatureFlagRef, gateDefaultValue: boolean | undefined): boolean {
  const refDefault = typeof ref === 'object' ? ref.defaultValue : undefined;
  return refDefault ?? gateDefaultValue ?? false;
}

/**
 * Whether a flag ref is on, given the adapter's answers. An answer wins, `false` included; a key the adapter left
 * out is one it does not know, and only then does {@link gateFallback} apply.
 */
export function isRefEnabled(
  ref: FeatureFlagRef,
  answers: Map<string, boolean>,
  gateDefaultValue: boolean | undefined,
): boolean {
  const key = flagKeyOf(ref);
  if (answers.has(key)) return answers.get(key) === true;
  return gateFallback(ref, gateDefaultValue);
}

/**
 * One feature flag as an `EnabledSource`: on when the adapter answers the flag is on for the caller, and changing
 * whenever the adapter reports a change (`FeatureFlagAdapter.subscribe`). The plugin's gates ask it, and an entry
 * can use one as `enabled`.
 */
export class FeatureFlagSource implements EnabledSource {
  readonly remedy: ErrorRemedy;

  constructor(
    private readonly adapter: FeatureFlagAdapter,
    private readonly ref: FeatureFlagRef,
    private readonly options: FeatureFlagSourceOptions = {},
  ) {
    this.remedy = { say: `Turn on the feature flag "${flagKeyOf(ref)}".` };
  }

  async get(context?: FrontMcpContext): Promise<boolean> {
    try {
      const answers = await this.adapter.evaluateFlags(
        [flagKeyOf(this.ref)],
        buildFeatureFlagContext(context, this.options),
      );
      return isRefEnabled(this.ref, answers, this.options.gateDefaultValue);
    } catch {
      return gateFallback(this.ref, this.options.gateDefaultValue);
    }
  }

  subscribe(listener: () => void): () => void {
    return this.adapter.subscribe?.(listener) ?? (() => undefined);
  }
}

/**
 * An `EnabledSource` for the flag `ref` of `adapter`, for `enabled` on a tool, resource, template or prompt:
 * `@Tool({ name: 'beta_report', enabled: featureFlagSource(flags, 'beta') })`. Give the plugin the same adapter
 * (`adapter: 'custom', adapterInstance: flags`).
 */
export function featureFlagSource(
  adapter: FeatureFlagAdapter,
  ref: FeatureFlagRef,
  options?: FeatureFlagSourceOptions,
): FeatureFlagSource {
  return new FeatureFlagSource(adapter, ref, options);
}

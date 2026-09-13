import {
  dashboardPluginOptionsSchema,
  defaultDashboardPluginOptions,
  type DashboardPluginOptions,
  type DashboardPluginOptionsInput,
} from './dashboard.types';

/**
 * The options the operator passed to `DashboardPlugin.init(...)`.
 *
 * `DashboardApp` declares `DashboardHttpPlugin.init({})` inside an `@App`
 * decorator, which is evaluated at module load — there is no seam to pass
 * runtime options through it. The result was that the operator's `auth`,
 * `basePath` and `cdn` never reached the middleware that serves the dashboard,
 * so even a correct token check would have had nothing to check against
 * (GHSA-rgxj-434m-vxh3).
 *
 * `DashboardPlugin.init(...)` publishes here, and the HTTP plugin reads it when
 * its scope is built. Ordering is safe: `init(...)` runs while the `@FrontMcp`
 * metadata object is being evaluated, which is strictly before any scope is
 * constructed.
 */
let publishedOptions: DashboardPluginOptions | undefined;

/** Record the operator's parsed options. Called by `DashboardPlugin.init`. */
export function publishDashboardOptions(options: DashboardPluginOptions): void {
  publishedOptions = options;
}

/**
 * The effective dashboard options: the operator's if they configured the plugin,
 * otherwise the defaults merged with whatever the caller supplied.
 */
export function resolveDashboardOptions(fallback: DashboardPluginOptionsInput = {}): DashboardPluginOptions {
  if (publishedOptions) return publishedOptions;
  return dashboardPluginOptionsSchema.parse({ ...defaultDashboardPluginOptions, ...fallback });
}

/** Test seam — clears the published options between cases. */
export function resetDashboardOptions(): void {
  publishedOptions = undefined;
}

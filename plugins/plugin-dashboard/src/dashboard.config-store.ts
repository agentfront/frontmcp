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

/**
 * Record the operator's parsed options. Called by `DashboardPlugin.init`.
 *
 * KNOWN LIMITATION — this store is process-wide. Two `@FrontMcp` servers built
 * in one process that each configure the dashboard differently would share the
 * last configuration published, including its `auth.token`. `init(...)` runs
 * while decorator metadata is evaluated, before any server or scope exists, so
 * there is no server identity to key on at that point; giving each server its
 * own configuration needs the app-declared plugin to receive options through the
 * provider graph, which the `@App` decorator shape does not currently allow.
 *
 * A conflicting publish is therefore reported loudly rather than silently
 * winning. Single-server processes — every documented deployment — are
 * unaffected.
 */
export function publishDashboardOptions(options: DashboardPluginOptions): void {
  if (publishedOptions && !sameConfiguration(publishedOptions, options)) {
    // A conflicting AUTH setting is refused outright. Replacing it would make
    // one server's dashboard credential valid on another's, invisibly — a worse
    // outcome than refusing to boot.
    if (!sameAuth(publishedOptions, options)) {
      throw new Error(
        '[frontmcp:dashboard] A second, different dashboard AUTH configuration was registered in this process. ' +
          "Dashboard options are process-wide, so accepting it would apply one server's token to another. " +
          'Run one dashboard per process, or give both servers the same auth configuration.',
      );
    }

    // Everything else (basePath, cdn) is a rendering concern: the last one
    // silently wins, which is worth a warning but not worth taking the process
    // down for.
    console.warn(
      '[frontmcp:dashboard] A second, different dashboard configuration was registered in this process. ' +
        'Dashboard options are process-wide, so the last one wins for every server here. ' +
        'Run one dashboard per process until per-instance configuration is supported.',
    );
  }
  publishedOptions = options;
}

/** Whether two configurations authenticate identically. */
function sameAuth(a: DashboardPluginOptions, b: DashboardPluginOptions): boolean {
  return a.auth?.enabled === b.auth?.enabled && a.auth?.token === b.auth?.token;
}

/**
 * Whether two configurations would behave identically.
 *
 * Compares every field that changes what a dashboard serves — `cdn` included,
 * since `generateDashboardHtml` builds the script URLs and the external
 * entrypoint from it, so a silent swap would serve one server's HTML with
 * another's CDN.
 */
function sameConfiguration(a: DashboardPluginOptions, b: DashboardPluginOptions): boolean {
  return (
    a.basePath === b.basePath &&
    a.enabled === b.enabled &&
    a.auth?.enabled === b.auth?.enabled &&
    a.auth?.token === b.auth?.token &&
    JSON.stringify(a.cdn ?? {}) === JSON.stringify(b.cdn ?? {})
  );
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

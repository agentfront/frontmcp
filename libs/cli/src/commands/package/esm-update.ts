/**
 * @file esm-update.ts
 * @description CLI command for checking and applying ESM package updates.
 *
 * Reads the registry for ESM-installed apps, checks for updates using the
 * VersionPoller, downloads and caches new versions, and updates the registry.
 */

import { Command } from 'commander';
import { readRegistry, writeRegistry } from './registry';
import { PM_DIRS } from '../pm/paths';

/**
 * Register the `esm-update` subcommand.
 *
 * Usage:
 *   frontmcp package esm-update [app-name]
 *
 * Options:
 *   --check-only   Only check for updates, don't apply them
 *   --all          Update all ESM-installed apps
 */
export function registerEsmUpdateCommand(program: Command): void {
  program
    .command('esm-update [app-name]')
    .description('Check and apply ESM package updates')
    .option('--check-only', 'Only check for updates without applying them', false)
    .option('--all', 'Update all ESM-installed apps', false)
    .action(async (appName: string | undefined, opts: { checkOnly: boolean; all: boolean }) => {
      const { EsmCacheManager, EsmModuleLoader, VersionPoller, parsePackageSpecifier } = await import('@frontmcp/sdk');

      const registry = readRegistry();
      if (!registry) {
        console.error('No registry found. Install an app first with `frontmcp package install`.');
        process.exit(1);
      }

      // Find ESM apps to update
      const esmApps = Object.entries(registry.apps).filter(([, app]) => {
        if (appName && !opts.all) {
          return app.source?.type === 'esm';
        }
        return app.source?.type === 'esm';
      });

      if (appName && !opts.all) {
        const filtered = esmApps.filter(([name]) => name === appName);
        if (filtered.length === 0) {
          console.error(`App "${appName}" not found or is not an ESM app.`);
          process.exit(1);
        }
      }

      if (esmApps.length === 0) {
        console.log('No ESM apps found in registry.');
        return;
      }

      const cache = new EsmCacheManager({ cacheDir: PM_DIRS.esmCache });
      const loader = new EsmModuleLoader({ cache });

      console.log(`Checking ${esmApps.length} ESM app(s) for updates...\n`);

      for (const [name, app] of esmApps) {
        if (appName && !opts.all && name !== appName) continue;

        const sourceRef = app.source?.ref;
        if (!sourceRef) continue;

        try {
          const specifier = parsePackageSpecifier(sourceRef);
          const currentVersion = app.esmVersion ?? app.version;

          // Check for updates
          const result = await loader.resolveVersion(specifier);

          if (result === currentVersion) {
            console.log(`  ${name}: up to date (${currentVersion})`);
            continue;
          }

          console.log(`  ${name}: ${currentVersion} → ${result}`);

          if (opts.checkOnly) continue;

          // Apply the update
          const loadResult = await loader.load(specifier);
          app.esmVersion = loadResult.resolvedVersion;
          app.esmCachePath = PM_DIRS.esmCache;
          app.lastUpdateCheck = new Date().toISOString();
          app.version = loadResult.resolvedVersion;

          console.log(`    Updated to ${loadResult.resolvedVersion} (source: ${loadResult.source})`);
        } catch (error) {
          console.error(`  ${name}: failed - ${(error as Error).message}`);
        }
      }

      if (!opts.checkOnly) {
        writeRegistry(registry);
        console.log('\nRegistry updated.');
      }
    });
}

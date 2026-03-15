/**
 * @file version-poller.ts
 * @description Background polling service that checks npm registry for new package versions.
 * Triggers callbacks when a new version matching the semver range is detected.
 */

import type { FrontMcpLogger } from '../common';
import type { EsmRegistryAuth } from './esm-auth.types';
import type { ParsedPackageSpecifier } from './package-specifier';
import { VersionResolver } from './version-resolver';
import { isNewerVersion, satisfiesRange } from './semver.utils';

/**
 * Result of checking a single package for updates.
 */
export interface VersionCheckResult {
  /** Full package name */
  packageName: string;
  /** Currently loaded version */
  currentVersion: string;
  /** Latest version matching the range */
  latestVersion: string;
  /** Whether a newer version is available */
  hasUpdate: boolean;
  /** Whether the latest version satisfies the original range */
  satisfiesRange: boolean;
}

/**
 * A tracked package entry in the poller.
 */
interface TrackedPackage {
  specifier: ParsedPackageSpecifier;
  currentVersion: string;
}

/**
 * Options for the version poller.
 */
export interface VersionPollerOptions {
  /** Polling interval in milliseconds (default: 300000 = 5 minutes) */
  intervalMs?: number;
  /** Authentication for private registries */
  registryAuth?: EsmRegistryAuth;
  /** Logger instance */
  logger?: FrontMcpLogger;
  /** Callback when a new version is detected */
  onNewVersion: (packageName: string, oldVersion: string, newVersion: string) => Promise<void>;
}

/** Default polling interval: 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Background service that periodically checks npm registry for package updates.
 *
 * When a new version matching the semver range is detected, triggers the
 * `onNewVersion` callback to drive hot-reload of ESM packages.
 */
export class VersionPoller {
  private readonly intervalMs: number;
  private readonly logger?: FrontMcpLogger;
  private readonly onNewVersion: VersionPollerOptions['onNewVersion'];
  private readonly versionResolver: VersionResolver;
  private readonly packages: Map<string, TrackedPackage> = new Map();
  private intervalId?: ReturnType<typeof setInterval>;
  private running = false;
  private polling = false;

  constructor(options: VersionPollerOptions) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.logger = options.logger;
    this.onNewVersion = options.onNewVersion;
    this.versionResolver = new VersionResolver({
      registryAuth: options.registryAuth,
    });
  }

  /**
   * Add a package to the polling watchlist.
   *
   * @param specifier - Parsed package specifier with semver range
   * @param currentVersion - Currently loaded concrete version
   */
  addPackage(specifier: ParsedPackageSpecifier, currentVersion: string): void {
    this.packages.set(specifier.fullName, { specifier, currentVersion });
    this.logger?.debug(
      `Version poller: tracking ${specifier.fullName}@${specifier.range} (current: ${currentVersion})`,
    );
  }

  /**
   * Remove a package from the polling watchlist.
   */
  removePackage(packageName: string): void {
    this.packages.delete(packageName);
    this.logger?.debug(`Version poller: stopped tracking ${packageName}`);
  }

  /**
   * Update the current version for a tracked package (after hot-reload).
   */
  updateCurrentVersion(packageName: string, newVersion: string): void {
    const entry = this.packages.get(packageName);
    if (entry) {
      entry.currentVersion = newVersion;
    }
  }

  /**
   * Start the background polling loop.
   */
  start(): void {
    if (this.running) return;
    if (this.packages.size === 0) return;

    this.running = true;
    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.intervalMs);

    this.logger?.info(`Version poller started (interval: ${this.intervalMs}ms, packages: ${this.packages.size})`);
  }

  /**
   * Stop the background polling loop.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }

    this.logger?.info('Version poller stopped');
  }

  /**
   * Check all tracked packages for updates immediately (without waiting for the interval).
   *
   * @returns Array of check results for all tracked packages
   */
  async checkNow(): Promise<VersionCheckResult[]> {
    const results: VersionCheckResult[] = [];

    for (const [, entry] of this.packages) {
      try {
        const result = await this.checkPackage(entry);
        results.push(result);
      } catch (error) {
        this.logger?.warn(`Version check failed for ${entry.specifier.fullName}: ${(error as Error).message}`);
      }
    }

    return results;
  }

  /**
   * Whether the poller is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Number of packages being tracked.
   */
  get trackedCount(): number {
    return this.packages.size;
  }

  /**
   * Internal polling loop iteration.
   */
  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const [, entry] of this.packages) {
        try {
          const result = await this.checkPackage(entry);
          if (result.hasUpdate) {
            this.logger?.info(
              `New version available for ${entry.specifier.fullName}: ${entry.currentVersion} → ${result.latestVersion}`,
            );
            await this.onNewVersion(entry.specifier.fullName, entry.currentVersion, result.latestVersion);
            // Update the tracked version after successful callback
            entry.currentVersion = result.latestVersion;
          }
        } catch (error) {
          this.logger?.warn(`Version poll failed for ${entry.specifier.fullName}: ${(error as Error).message}`);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  /**
   * Check a single package for updates.
   */
  private async checkPackage(entry: TrackedPackage): Promise<VersionCheckResult> {
    const resolution = await this.versionResolver.resolve(entry.specifier);

    const hasUpdate =
      resolution.resolvedVersion !== entry.currentVersion &&
      isNewerVersion(resolution.resolvedVersion, entry.currentVersion);

    const rangeMatch = satisfiesRange(resolution.resolvedVersion, entry.specifier.range);

    return {
      packageName: entry.specifier.fullName,
      currentVersion: entry.currentVersion,
      latestVersion: resolution.resolvedVersion,
      hasUpdate: hasUpdate && rangeMatch,
      satisfiesRange: rangeMatch,
    };
  }
}

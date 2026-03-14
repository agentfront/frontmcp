/**
 * @file version-resolver.ts
 * @description Resolves semver ranges to concrete versions using the npm registry API.
 */

import type { EsmRegistryAuth } from './esm-auth.types';
import { resolveRegistryToken, getRegistryUrl } from './esm-auth.types';
import { maxSatisfying, isValidVersion } from './semver.utils';
import type { ParsedPackageSpecifier } from './package-specifier';

/**
 * Result of a version resolution.
 */
export interface VersionResolutionResult {
  /** The concrete version that was resolved */
  resolvedVersion: string;
  /** All available versions from the registry */
  availableVersions: string[];
  /** When the resolved version was published (ISO string) */
  publishedAt?: string;
}

/**
 * Options for the version resolver.
 */
export interface VersionResolverOptions {
  /** Authentication for private registries */
  registryAuth?: EsmRegistryAuth;
  /** Request timeout in milliseconds (default: 15000) */
  timeout?: number;
}

/**
 * Resolves semver ranges to concrete versions by querying the npm registry API.
 */
export class VersionResolver {
  private readonly registryAuth?: EsmRegistryAuth;
  private readonly timeout: number;

  constructor(options?: VersionResolverOptions) {
    this.registryAuth = options?.registryAuth;
    this.timeout = options?.timeout ?? 15000;
  }

  /**
   * Resolve a package specifier's semver range to a concrete version.
   *
   * @param specifier - Parsed package specifier with range
   * @returns Resolution result with concrete version
   * @throws Error if the package is not found or no version matches the range
   */
  async resolve(specifier: ParsedPackageSpecifier): Promise<VersionResolutionResult> {
    const registryUrl = getRegistryUrl(this.registryAuth);
    const packageUrl = `${registryUrl}/${encodePackageName(specifier.fullName)}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    const token = resolveRegistryToken(this.registryAuth);
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let response: Response;
    try {
      response = await fetch(packageUrl, {
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timeout resolving version for "${specifier.fullName}" after ${this.timeout}ms`);
      }
      throw new Error(`Failed to fetch package info for "${specifier.fullName}": ${(error as Error).message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 404) {
      throw new Error(`Package "${specifier.fullName}" not found in registry at ${registryUrl}`);
    }

    if (!response.ok) {
      throw new Error(`Registry returned ${response.status} for "${specifier.fullName}": ${response.statusText}`);
    }

    const data = (await response.json()) as NpmRegistryResponse;
    return this.resolveFromRegistryData(specifier, data);
  }

  /**
   * Resolve version from already-fetched registry data.
   */
  private resolveFromRegistryData(
    specifier: ParsedPackageSpecifier,
    data: NpmRegistryResponse,
  ): VersionResolutionResult {
    const versions = Object.keys(data.versions ?? {});
    if (versions.length === 0) {
      throw new Error(`No versions found for "${specifier.fullName}"`);
    }

    // Handle 'latest' tag by checking dist-tags
    if (specifier.range === 'latest') {
      const latestVersion = data['dist-tags']?.['latest'];
      if (latestVersion && isValidVersion(latestVersion)) {
        return {
          resolvedVersion: latestVersion,
          availableVersions: versions,
          publishedAt: data.time?.[latestVersion],
        };
      }
    }

    // Handle other dist-tags (e.g., 'next', 'beta')
    if (data['dist-tags']?.[specifier.range]) {
      const tagVersion = data['dist-tags'][specifier.range];
      if (isValidVersion(tagVersion)) {
        return {
          resolvedVersion: tagVersion,
          availableVersions: versions,
          publishedAt: data.time?.[tagVersion],
        };
      }
    }

    // Semver range resolution
    const resolved = maxSatisfying(versions, specifier.range);
    if (!resolved) {
      throw new Error(
        `No version of "${specifier.fullName}" satisfies range "${specifier.range}". ` +
          `Available versions: ${versions.slice(-5).join(', ')}${versions.length > 5 ? '...' : ''}`,
      );
    }

    return {
      resolvedVersion: resolved,
      availableVersions: versions,
      publishedAt: data.time?.[resolved],
    };
  }
}

/**
 * Encode a scoped package name for use in registry URLs.
 * '@scope/name' -> '@scope%2fname'
 */
function encodePackageName(name: string): string {
  return name.replace('/', '%2f');
}

/**
 * Minimal npm registry response shape (we only use what we need).
 */
interface NpmRegistryResponse {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, unknown>;
  time?: Record<string, string>;
}

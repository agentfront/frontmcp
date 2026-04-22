// common/types/options/cloud/merge.ts
//
// Merges `CloudContributions` into a FrontMcp metadata object. Arrays are
// always additive (cloud contributions append to user-supplied entries);
// scalar/object fields use the strategy declared in `optionsOverride`.

import type { CloudContributions, FieldMergeStrategy } from './provider';

/**
 * Keys that must never be set via `optionsOverride`. Writing to `__proto__`
 * / `constructor` / `prototype` on a plain object can pollute the prototype
 * chain and affect unrelated objects. Since cloud contributions may
 * eventually arrive from network-sourced configs, defend here.
 */
const FORBIDDEN_OVERRIDE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export interface MergeLogger {
  warn(msg: string, meta?: Record<string, unknown>): void;
}

/**
 * Apply cloud contributions to a user-supplied metadata object, returning a
 * new metadata object with the contributions layered in. The input is not
 * mutated.
 *
 * Strategy semantics:
 * - `additive`: concat arrays, shallow-merge plain objects (user keys win on
 *   conflict; the base spread covers cloud-only keys).
 * - `override`: cloud value replaces user value entirely.
 * - `fillGaps`: cloud value is used only when the user value is undefined.
 *
 * Unknown strategies fall through to `fillGaps` (safest default).
 *
 * @param logger optional — surfaces warnings for silently-dropped cloud
 *   array contributions and rejected prototype-polluting keys. Pass a
 *   console-shim during bootstrap; attach the real FrontMcpLogger later.
 */
export function mergeCloudContributions<T extends Record<string, unknown>>(
  userMetadata: T,
  contributions: CloudContributions | undefined,
  logger?: MergeLogger,
): T {
  if (!contributions) return userMetadata;

  const out: Record<string, unknown> = { ...userMetadata };

  // Array fields — always additive (cloud appends).
  appendArray(out, 'plugins', contributions.plugins, logger);
  appendArray(out, 'adapters', contributions.adapters, logger);
  appendArray(out, 'providers', contributions.providers, logger);
  appendArray(out, 'tools', contributions.tools, logger);
  appendArray(out, 'resources', contributions.resources, logger);
  appendArray(out, 'skills', contributions.skills, logger);
  appendArray(out, 'apps', contributions.apps, logger);

  // Per-field option overrides.
  if (contributions.optionsOverride) {
    for (const [key, override] of Object.entries(contributions.optionsOverride)) {
      if (FORBIDDEN_OVERRIDE_KEYS.has(key)) {
        logger?.warn('cloud: refusing optionsOverride on prototype-polluting key', { key });
        continue;
      }
      out[key] = applyOverride(out[key], override.value, override.strategy);
    }
  }

  return out as T;
}

function appendArray(
  target: Record<string, unknown>,
  key: string,
  extra: unknown[] | undefined,
  logger?: MergeLogger,
): void {
  if (!extra || extra.length === 0) return;
  const existing = target[key];
  if (Array.isArray(existing)) {
    target[key] = [...existing, ...extra];
  } else if (existing === undefined) {
    target[key] = [...extra];
  } else {
    // Non-array existing value — preserve user intent, skip cloud additions.
    // Surface this so misconfigurations don't disappear silently.
    logger?.warn(`cloud: skipped ${extra.length} contribution(s) to '${key}' — existing value is not an array`, {
      key,
      existingType: typeof existing,
    });
  }
}

function applyOverride(userValue: unknown, cloudValue: unknown, strategy: FieldMergeStrategy): unknown {
  switch (strategy) {
    case 'override':
      return cloudValue;

    case 'fillGaps':
      return userValue === undefined ? cloudValue : userValue;

    case 'additive':
      return additiveMerge(userValue, cloudValue);

    default:
      // Unknown strategy — treat as fillGaps (safest).
      return userValue === undefined ? cloudValue : userValue;
  }
}

function additiveMerge(userValue: unknown, cloudValue: unknown): unknown {
  if (userValue === undefined) return cloudValue;
  if (cloudValue === undefined) return userValue;

  if (Array.isArray(userValue) && Array.isArray(cloudValue)) {
    return [...userValue, ...cloudValue];
  }

  if (isPlainObject(userValue) && isPlainObject(cloudValue)) {
    // Cloud provides defaults; user keys win on conflict. The spread order
    // achieves both: cloud-only keys land first, user spread wins ties.
    return { ...cloudValue, ...userValue };
  }

  // Scalar or mismatched types — user wins.
  return userValue;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

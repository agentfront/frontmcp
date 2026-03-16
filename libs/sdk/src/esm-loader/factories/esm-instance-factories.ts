/**
 * @file esm-instance-factories.ts
 * @description Factory functions that create standard instances for ESM-loaded primitives.
 *
 * Uses the esm-record-builders to create records, then instantiates standard
 * ToolInstance, ResourceInstance, and PromptInstance. This allows ESM-loaded
 * entities to use the same hook lifecycle and registry infrastructure as local entities.
 */

import type { EntryOwnerRef } from '../../common';
import type ProviderRegistry from '../../provider/provider.registry';
import { ToolInstance } from '../../tool/tool.instance';
import { ResourceInstance } from '../../resource/resource.instance';
import { PromptInstance } from '../../prompt/prompt.instance';
import { buildEsmToolRecord, buildEsmResourceRecord, buildEsmPromptRecord } from './esm-record-builders';
import type { EsmToolDefinition, EsmResourceDefinition, EsmPromptDefinition } from './esm-record-builders';

/**
 * Create a standard ToolInstance for an ESM-loaded tool.
 *
 * The resulting ToolInstance executes the tool's code locally in-process
 * and participates fully in the hook lifecycle.
 *
 * @param tool - ESM tool definition with execute function
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix for the tool name
 * @returns A standard ToolInstance that executes the ESM tool locally
 */
export function createEsmToolInstance(
  tool: EsmToolDefinition,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ToolInstance {
  const record = buildEsmToolRecord(tool, namespace);
  return new ToolInstance(record, providers, owner);
}

/**
 * Create a standard ResourceInstance for an ESM-loaded resource.
 *
 * @param resource - ESM resource definition with read function
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix
 * @returns A standard ResourceInstance that reads the ESM resource locally
 */
export function createEsmResourceInstance(
  resource: EsmResourceDefinition,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): ResourceInstance {
  const record = buildEsmResourceRecord(resource, namespace);
  return new ResourceInstance(record, providers, owner);
}

/**
 * Create a standard PromptInstance for an ESM-loaded prompt.
 *
 * @param prompt - ESM prompt definition with execute function
 * @param providers - The provider registry for DI and scope access
 * @param owner - The entry owner reference (app owner)
 * @param namespace - Optional namespace prefix
 * @returns A standard PromptInstance that executes the ESM prompt locally
 */
export function createEsmPromptInstance(
  prompt: EsmPromptDefinition,
  providers: ProviderRegistry,
  owner: EntryOwnerRef,
  namespace?: string,
): PromptInstance {
  const record = buildEsmPromptRecord(prompt, namespace);
  return new PromptInstance(record, providers, owner);
}

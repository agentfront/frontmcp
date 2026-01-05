/**
 * Context Extension System
 *
 * Provides a mechanism for plugins to extend ExecutionContextBase with new properties.
 * This is handled by the SDK during plugin registration - plugins should NOT directly
 * modify ExecutionContextBase.
 *
 * @example
 * ```typescript
 * // In plugin metadata:
 * @Plugin({
 *   name: 'remember',
 *   contextExtensions: [
 *     { property: 'remember', token: RememberAccessorToken },
 *   ],
 * })
 *
 * // In tools (when plugin is installed):
 * await this.remember.set('key', 'value');
 * ```
 *
 * @internal
 */

import { Token } from '@frontmcp/di';
import { ExecutionContextBase } from '../common/interfaces/execution-context.interface';
import { PromptContext } from '../common/interfaces/prompt.interface';
import type { ContextExtension } from '../common/metadata/plugin.metadata';

// Track installed extensions to avoid duplicates
const installedExtensions = new Set<string>();

/**
 * Install context extensions declared by a plugin.
 * Called by the SDK during plugin registration.
 *
 * @param pluginName - Name of the plugin (for error messages)
 * @param extensions - Array of context extensions to install
 *
 * @internal
 */
export function installContextExtensions(pluginName: string, extensions: ContextExtension[]): void {
  for (const ext of extensions) {
    const { property, token, errorMessage } = ext;

    // Skip if already installed (idempotent)
    if (installedExtensions.has(property)) {
      continue;
    }

    // Check if property already exists on prototype (from another source)
    if (Object.prototype.hasOwnProperty.call(ExecutionContextBase.prototype, property)) {
      console.warn(`[${pluginName}] Context property '${property}' already exists on ExecutionContextBase. Skipping.`);
      continue;
    }

    // Create default error message
    const defaultErrorMessage = errorMessage ?? `${pluginName} is not installed or '${property}' is not configured.`;

    // Add lazy getter to ExecutionContextBase.prototype (for ToolContext, ResourceContext, etc.)
    Object.defineProperty(ExecutionContextBase.prototype, property, {
      get: function (this: ExecutionContextBase): unknown {
        try {
          return this.get(token as Token<unknown>);
        } catch (err) {
          // Preserve original error as cause for debugging
          throw new Error(defaultErrorMessage, { cause: err });
        }
      },
      configurable: true,
      enumerable: false,
    });

    // Also add to PromptContext.prototype (PromptContext doesn't extend ExecutionContextBase)
    if (!Object.prototype.hasOwnProperty.call(PromptContext.prototype, property)) {
      Object.defineProperty(PromptContext.prototype, property, {
        get: function (this: PromptContext): unknown {
          try {
            return this.get(token as Token<unknown>);
          } catch (err) {
            // Preserve original error as cause for debugging
            throw new Error(defaultErrorMessage, { cause: err });
          }
        },
        configurable: true,
        enumerable: false,
      });
    }

    installedExtensions.add(property);
  }
}

/**
 * Check if a context extension property is installed.
 *
 * @param property - Property name to check
 * @returns true if the property is installed
 *
 * @internal
 */
export function isContextExtensionInstalled(property: string): boolean {
  return installedExtensions.has(property);
}

/**
 * Get list of all installed context extension properties.
 *
 * @returns Array of installed property names
 *
 * @internal
 */
export function getInstalledContextExtensions(): string[] {
  return [...installedExtensions];
}

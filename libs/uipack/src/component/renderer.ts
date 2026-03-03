/**
 * Component Renderer
 *
 * Generates complete HTML shell for any UI component source.
 * Combines the resolver, shell builder, and component loader.
 *
 * @packageDocumentation
 */

import type { ShellConfig, ShellResult } from '../shell/types';
import type { ImportResolver } from '../resolver/types';
import type { UIConfig, ResolvedComponent } from './types';
import { resolveUISource, generateMountScript } from './loader';
import { buildShell } from '../shell/builder';
import { createEsmShResolver } from '../resolver/esm-sh.resolver';
import { createImportMapFromResolved } from '../resolver/import-map';
import type { ResolvedImport } from '../resolver/types';
import { generateImportMapScriptTag } from '../resolver/import-map';

/**
 * Render a complete HTML shell for a UI component.
 *
 * @example
 * ```typescript
 * // NPM component
 * const result = renderComponent(
 *   { source: { npm: '@acme/dashboard-widget' } },
 *   { toolName: 'my_tool', output: { data: [1,2,3] } }
 * );
 *
 * // Function component
 * const result = renderComponent(
 *   { source: (input, output) => `<div>${output.message}</div>` },
 *   { toolName: 'my_tool', output: { message: 'Hello' } }
 * );
 * ```
 */
export function renderComponent(config: UIConfig, shellConfig: ShellConfig): ShellResult {
  const resolver = shellConfig.resolver ?? createEsmShResolver();

  const resolved = resolveUISource(config.source, {
    resolver,
    input: shellConfig.input,
    output: shellConfig.output,
  });

  const mergedShellConfig = {
    ...shellConfig,
    withShell: config.withShell ?? shellConfig.withShell,
    includeBridge: config.includeBridge ?? shellConfig.includeBridge,
    customShell: config.customShell ?? shellConfig.customShell,
  };

  if (resolved.mode === 'inline') {
    // Inline HTML: place directly in body
    return buildShell(resolved.html ?? '', mergedShellConfig);
  }

  // Module mode: generate import map + mount script
  const content = buildModuleContent(resolved, resolver, config.props);

  return buildShell(content, mergedShellConfig);
}

/**
 * Build HTML content for module-based components.
 * Includes import map and mount script.
 *
 * For inline modules (resolved.code present): embeds transpiled source + mount code
 * as a single `<script type="module">` with an import map for all external dependencies.
 *
 * For URL modules (resolved.url present): uses existing import + mount approach.
 */
function buildModuleContent(
  resolved: ResolvedComponent,
  resolver: ImportResolver,
  propsMapping?: Record<string, string>,
): string {
  const parts: string[] = [];

  if (resolved.code && resolved.bundled) {
    // === BUNDLED MODULE PATH ===
    // Workspace deps are inlined. Only react/react-dom externals remain.
    // Mount code is already in the bundle.
    const importEntries: Record<string, ResolvedImport> = {};

    for (const spec of resolved.imports || []) {
      const depResolved = resolver.resolve(spec);
      if (depResolved) {
        importEntries[spec] = depResolved;
      }
    }

    if (Object.keys(importEntries).length > 0) {
      const importMap = createImportMapFromResolved(importEntries);
      parts.push(generateImportMapScriptTag(importMap));
    }

    parts.push('<div id="root"></div>');
    parts.push(`<script type="module">\n${resolved.code}\n</script>`);
  } else if (resolved.code) {
    // === INLINE MODULE PATH (transpiled .tsx/.jsx, non-bundled) ===
    const importEntries: Record<string, ResolvedImport> = {};

    // Collect all specifiers: from source imports + mount dependencies
    const allSpecifiers = new Set([
      ...(resolved.imports || []),
      'react-dom/client', // needed by mount script
      '@frontmcp/ui/react', // needed for McpBridgeProvider
      // React subpath entries needed by esm.sh externalized modules:
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/server',
      'react-dom/static',
    ]);

    const coreDeps = new Set([
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/server',
      'react-dom/static',
    ]);

    for (const spec of allSpecifiers) {
      const depResolved = resolver.resolve(spec);
      if (depResolved) {
        // Add ?external=react,react-dom for non-core esm.sh packages
        // This ensures a single React instance across all modules
        if (!coreDeps.has(spec) && depResolved.value?.includes('esm.sh')) {
          importEntries[spec] = {
            ...depResolved,
            value: addExternalParam(depResolved.value, ['react', 'react-dom']),
          };
        } else {
          importEntries[spec] = depResolved;
        }
      }
    }

    // Ensure react-dom/client is mapped
    if (importEntries['react-dom'] && !importEntries['react-dom/client']) {
      const rdc = resolver.resolve('react-dom/client');
      if (rdc) importEntries['react-dom/client'] = rdc;
    }

    // Generate import map
    if (Object.keys(importEntries).length > 0) {
      const importMap = createImportMapFromResolved(importEntries);
      parts.push(generateImportMapScriptTag(importMap));
    }

    parts.push('<div id="root"></div>');

    // Embed transpiled code + mount code in a single <script type="module">
    const mountCode = generateInlineMountCode(resolved.exportName);
    parts.push(`<script type="module">\n${resolved.code}\n${mountCode}\n</script>`);
  } else {
    // === URL MODULE PATH (existing behavior) ===
    const importEntries: Record<string, ResolvedImport> = {};

    for (const dep of resolved.peerDependencies) {
      const depResolved = resolver.resolve(dep);
      if (depResolved) {
        importEntries[dep] = depResolved;
      }
    }

    // Add react-dom/client mapping if react-dom is present
    if (importEntries['react-dom']) {
      const reactDomClient = resolver.resolve('react-dom/client');
      if (reactDomClient) {
        importEntries['react-dom/client'] = reactDomClient;
      }
    }

    // Generate import map
    if (Object.keys(importEntries).length > 0) {
      const importMap = createImportMapFromResolved(importEntries);
      parts.push(generateImportMapScriptTag(importMap));
    }

    // Root element
    parts.push('<div id="root"></div>');

    // Mount script
    const mountScript = generateMountScript(resolved, propsMapping);
    if (mountScript) {
      parts.push(`<script type="module">\n${mountScript}\n</script>`);
    }
  }

  return parts.join('\n');
}

/**
 * Append `?external=react,react-dom` to an esm.sh URL to ensure
 * a single React instance is shared across all loaded modules.
 */
function addExternalParam(url: string, externals: string[]): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}external=${externals.join(',')}`;
}

/**
 * Generate mount code for inline modules.
 *
 * Wraps the component in McpBridgeProvider so that hooks like
 * useToolOutput, useToolInput, useTheme etc. work correctly.
 */
function generateInlineMountCode(componentName: string): string {
  return `
// --- Mount ---
import { createRoot as __createRoot } from 'react-dom/client';
import { McpBridgeProvider as __McpBridgeProvider } from '@frontmcp/ui/react';
const __root = document.getElementById('root');
if (__root) {
  __createRoot(__root).render(
    React.createElement(__McpBridgeProvider, null,
      React.createElement(${componentName})
    )
  );
}`;
}

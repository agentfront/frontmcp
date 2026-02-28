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
 */
function buildModuleContent(
  resolved: ResolvedComponent,
  resolver: ImportResolver,
  propsMapping?: Record<string, string>,
): string {
  const parts: string[] = [];

  // Resolve peer dependencies to import map
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

  return parts.join('\n');
}

/**
 * Component Renderer
 *
 * Generates complete HTML shell for any UI component source.
 * Combines the resolver, shell builder, and component loader.
 *
 * @packageDocumentation
 */

import { createEsmShResolver } from '../resolver/esm-sh.resolver';
import { createImportMapFromResolved, generateImportMapScriptTag } from '../resolver/import-map';
import { type ImportResolver, type ResolvedImport } from '../resolver/types';
import { buildShell } from '../shell/builder';
import { type ShellConfig, type ShellMountDescriptor, type ShellResult } from '../shell/types';
import { generateMountScript, resolveUISource } from './loader';
import { type ResolvedComponent, type UIConfig } from './types';

/**
 * Default inline-module mount descriptor: the tool-widget mount.
 *
 * Wraps the component in `McpBridgeProvider` from `@frontmcp/ui/react` so the
 * widget hooks (`useToolOutput`, `useToolInput`, `useTheme`, …) work. Callers
 * that don't supply a {@link ShellMountDescriptor} get exactly this — keeping
 * tool-widget output byte-for-byte unchanged.
 */
const DEFAULT_WIDGET_MOUNT: ShellMountDescriptor = {
  moduleSpecifier: '@frontmcp/ui/react',
  wrapperImportName: 'McpBridgeProvider',
};

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
    inlineReact: config.inlineReact === true,
    transformOnly: config.transformOnly === true,
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

  // Module mode: generate import map + mount script. The inline-module path's
  // mount tail + import-map mounter are driven by the (pluggable) mount
  // descriptor; absent one it defaults to the widget McpBridgeProvider mount.
  const content = buildModuleContent(resolved, resolver, config.props, shellConfig.mount);

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
  mount: ShellMountDescriptor = DEFAULT_WIDGET_MOUNT,
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

    // Collect all specifiers: from source imports + mount dependencies.
    // `mount.moduleSpecifier` is whatever the caller's mount tail imports the
    // mounter/provider from (default `@frontmcp/ui/react` for widgets); it is
    // always added so a non-default mounter resolves via the import map.
    const allSpecifiers = new Set([
      ...(resolved.imports || []),
      'react-dom/client', // needed by mount script
      mount.moduleSpecifier, // mounter/provider package (e.g. @frontmcp/ui/react)
      // React subpath entries needed by esm.sh externalized modules:
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ]);

    // The `react-dom/server` + `react-dom/static` subpaths back the widget
    // bridge's SSR-ish paths and are only mapped for the DEFAULT widget mount.
    // A custom (non-widget) mount — e.g. an auth page — maps only what its
    // source imports, so its page never advertises `react-dom/server`.
    if (mount === DEFAULT_WIDGET_MOUNT) {
      allSpecifiers.add('react-dom/server');
      allSpecifiers.add('react-dom/static');
    }

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

    // Mount node — id + inner content are pluggable (default `#root`, empty),
    // so a non-widget caller (e.g. an auth page) can ship `#frontmcp-auth-root`
    // with a `<noscript>` fallback over the SAME pipeline.
    const mountNodeId = mount.mountNodeId ?? 'root';
    parts.push(`<div id="${mountNodeId}">${mount.mountNodeInnerHtml ?? ''}</div>`);

    // Embed transpiled code + mount code in a single <script type="module">
    const mountCode = generateInlineMountCode(resolved.exportName, mount);
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
 * Generate the mount tail for inline modules.
 *
 * Pluggable via the {@link ShellMountDescriptor}:
 * - `mount.generate` — full override; returns the entire tail for the export.
 * - otherwise a provider-wrapper tail is generated that imports
 *   `mount.wrapperImportName` from `mount.moduleSpecifier` and wraps the
 *   component in it.
 *
 * The default ({@link DEFAULT_WIDGET_MOUNT}) wraps the component in
 * `McpBridgeProvider` from `@frontmcp/ui/react` so widget hooks
 * (`useToolOutput`, `useToolInput`, `useTheme`, …) work — and reproduces the
 * historical widget mount tail byte-for-byte.
 */
function generateInlineMountCode(componentName: string, mount: ShellMountDescriptor): string {
  if (mount.generate) {
    return mount.generate(componentName);
  }

  // Provider-wrapper tail. The local alias is derived from the wrapper name so
  // the default (`McpBridgeProvider`) yields `__McpBridgeProvider`, identical to
  // the historical widget output. The mount-node id matches the `<div>` the
  // renderer emits (default `root`), so a custom `mountNodeId` lands correctly.
  const wrapperName = mount.wrapperImportName ?? 'McpBridgeProvider';
  const wrapperAlias = `__${wrapperName}`;
  const mountNodeId = mount.mountNodeId ?? 'root';
  return `
// --- Mount ---
import { createRoot as __createRoot } from 'react-dom/client';
import { ${wrapperName} as ${wrapperAlias} } from '${mount.moduleSpecifier}';
const __root = document.getElementById('${mountNodeId}');
if (__root) {
  __createRoot(__root).render(
    React.createElement(${wrapperAlias}, null,
      React.createElement(${componentName})
    )
  );
}`;
}

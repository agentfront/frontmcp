/**
 * CDN Configuration
 *
 * Shared CDN constants, URLs, and script tag generators.
 * Extracted from esbuild-config.ts so these can be used
 * without depending on esbuild types.
 *
 * @packageDocumentation
 */

// ============================================
// Default Externals
// ============================================

/**
 * Default packages to externalize in hybrid mode.
 * These packages are loaded from the vendor shell's CDN scripts.
 */
export const DEFAULT_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@frontmcp/ui',
  '@frontmcp/ui/*',
];

/**
 * Global variable mappings for externalized packages.
 * Used to create namespace polyfills in the component chunk.
 */
export const EXTERNAL_GLOBALS: Record<string, string> = {
  'react': 'React',
  'react-dom': 'ReactDOM',
  'react/jsx-runtime': 'jsxRuntime',
  'react/jsx-dev-runtime': 'jsxRuntime',
  '@frontmcp/ui': 'FrontMcpUI',
};

// ============================================
// CDN URLs
// ============================================

/**
 * CDN URLs for external dependencies (esm.sh).
 */
export const CDN_URLS = {
  react: 'https://esm.sh/react@19',
  reactDom: 'https://esm.sh/react-dom@19',
  reactJsxRuntime: 'https://esm.sh/react@19/jsx-runtime',
  frontmcpUI: 'https://esm.sh/@frontmcp/ui',
  tailwind: 'https://cdn.tailwindcss.com',
} as const;

/**
 * Cloudflare CDN URLs (for Claude compatibility).
 */
export const CLOUDFLARE_CDN_URLS = {
  react: 'https://cdnjs.cloudflare.com/ajax/libs/react/19.0.0/umd/react.production.min.js',
  reactDom: 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/19.0.0/umd/react-dom.production.min.js',
  tailwind: 'https://cdn.tailwindcss.com',
} as const;

/**
 * Babel Standalone CDN URL for in-browser JSX transpilation.
 */
export const BABEL_STANDALONE_CDN = 'https://esm.sh/@babel/standalone@7';

/**
 * @frontmcp/ui runtime CDN URL (loaded via esm.sh).
 */
export const FRONTMCP_UI_CDN = 'https://esm.sh/@frontmcp/ui/runtime';

// ============================================
// Script Tag Generation
// ============================================

/**
 * Create JavaScript banner that defines external namespace objects.
 *
 * This banner is prepended to the transpiled code and provides
 * the global variables that the externalized imports reference.
 *
 * @param externals - List of external package names
 * @returns JavaScript banner code
 */
export function createExternalsBanner(externals: string[]): string {
  const lines: string[] = [
    '// Externalized dependencies - loaded from shell globals',
  ];

  for (const pkg of externals) {
    const globalName = EXTERNAL_GLOBALS[pkg];
    if (globalName) {
      // Create namespace object that references the global
      const safeName = pkg.replace(/[^a-zA-Z0-9]/g, '_');
      lines.push(`const __external_${safeName} = window.${globalName};`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate CDN script tags for the vendor shell.
 *
 * @param useCloudflare - Use Cloudflare CDN (for Claude)
 * @returns HTML script tags
 */
export function generateCdnScriptTags(useCloudflare = false): string {
  const urls = useCloudflare ? CLOUDFLARE_CDN_URLS : CDN_URLS;

  if (useCloudflare) {
    // Cloudflare uses UMD builds
    return `
    <script src="${urls.react}"></script>
    <script src="${urls.reactDom}"></script>
    <script src="${urls.tailwind}"></script>
    `;
  }

  // esm.sh uses ES modules with import map
  return `
    <script type="importmap">
      {
        "imports": {
          "react": "${CDN_URLS.react}",
          "react-dom": "${CDN_URLS.reactDom}",
          "react/jsx-runtime": "${CDN_URLS.reactJsxRuntime}",
          "@frontmcp/ui": "${CDN_URLS.frontmcpUI}"
        }
      }
    </script>
    <script src="${CDN_URLS.tailwind}"></script>
  `;
}

/**
 * Generate global namespace setup script.
 *
 * This script exposes React and other modules as globals
 * for the externalized component chunks to use.
 *
 * @returns JavaScript code to set up globals
 */
export function generateGlobalsSetupScript(): string {
  return `
    <script type="module">
      import React from 'react';
      import ReactDOM from 'react-dom/client';
      import * as jsxRuntime from 'react/jsx-runtime';

      // Expose as globals for externalized components
      window.React = React;
      window.ReactDOM = ReactDOM;
      window.jsxRuntime = jsxRuntime;

      // Signal that runtime is ready
      window.__frontmcpRuntimeReady = true;
      window.dispatchEvent(new CustomEvent('frontmcp:runtime-ready'));
    </script>
  `;
}

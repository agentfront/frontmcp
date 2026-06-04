/**
 * Shell Builder Types
 *
 * Configuration and result types for HTML shell generation.
 *
 * @packageDocumentation
 */

import type { ImportResolver } from '../resolver/types';
import type { ResolvedShellTemplate } from './custom-shell-types';

/**
 * Content Security Policy configuration for shell HTML.
 */
export interface CSPConfig {
  /** Origins allowed for fetch/XHR/WebSocket connections */
  connectDomains?: string[];
  /** Origins allowed for images, scripts, fonts, and styles */
  resourceDomains?: string[];
}

/**
 * Pluggable mount descriptor for the inline-module render path.
 *
 * Lets a caller supply the inline `<script type="module">` mount tail that is
 * appended after the transpiled component source — i.e. which package to import
 * the mounter/provider from and how to render the component into the page.
 *
 * This is the GENERIC shell hook: the tool-widget path leaves it unset and gets
 * the default `McpBridgeProvider` mount from `@frontmcp/ui/react`. A different
 * caller (e.g. an auth page) supplies its own `moduleSpecifier` +
 * `wrapperImportName` (or a full `generate`) to swap in a different shell over
 * the SAME render pipeline. The renderer also adds `moduleSpecifier` to the
 * import map (with the single-React `?external=react,react-dom` treatment) so a
 * non-default mounter is resolvable.
 *
 * No field here is auth-specific — the caller supplies the specifics.
 */
export interface ShellMountDescriptor {
  /**
   * Module specifier the mount tail imports the mounter/provider from
   * (e.g. `@frontmcp/ui/react` for the default widget mount). Always added to
   * the inline-module import map.
   */
  moduleSpecifier: string;
  /**
   * Named export to import from {@link moduleSpecifier} (the React provider or a
   * mount function). Used by the built-in tail generator when {@link generate}
   * is not supplied.
   */
  wrapperImportName?: string;
  /**
   * Full override for the mount tail. Receives the component's export name and
   * returns the JS appended after the transpiled source inside the inline
   * `<script type="module">`. When omitted, a default tail is generated from
   * {@link moduleSpecifier} + {@link wrapperImportName}.
   */
  generate?: (exportName: string) => string;
  /**
   * Id of the empty mount `<div>` the renderer emits before the inline module.
   * Defaults to `'root'` (the widget mount). A caller whose mounter targets a
   * different node (e.g. an auth page's `#frontmcp-auth-root`) overrides it.
   */
  mountNodeId?: string;
  /**
   * Inner HTML placed inside the mount `<div>` (e.g. a `<noscript>` fallback).
   * Default is empty. Emitted verbatim — the caller owns its safety (server
   * content only, never user input).
   */
  mountNodeInnerHtml?: string;
}

/**
 * Pluggable data-injection descriptor for the shell's injected window global.
 *
 * Lets a caller override the `<script>` that seeds page data onto a window
 * global. The tool-widget path leaves it unset and gets the default
 * `window.__mcp*` injection. A different caller (e.g. an auth page) provides its
 * own `globalKey` + `value` (or a full `script`) to inject a different global
 * over the SAME render pipeline.
 *
 * No field here is auth-specific — the caller supplies the key and value.
 */
export interface ShellDataInjectionDescriptor {
  /** Window global key to assign (e.g. `__MY_PAGE_STATE__`). */
  globalKey?: string;
  /** Value serialized (XSS-safe) and assigned to `window[globalKey]`. */
  value?: unknown;
  /**
   * Full override for the injection `<script>...</script>`. When provided it is
   * emitted verbatim and {@link globalKey} / {@link value} are ignored.
   */
  script?: string;
}

/**
 * Configuration for building an HTML shell.
 */
export interface ShellConfig {
  /** Tool name for data injection */
  toolName: string;
  /** Import resolver for dependencies */
  resolver?: ImportResolver;
  /** CSP configuration */
  csp?: CSPConfig;
  /** Whether to wrap in full HTML document (default: true) */
  withShell?: boolean;
  /** Data to inject as window globals */
  input?: unknown;
  output?: unknown;
  /** Structured content from parsing */
  structuredContent?: unknown;
  /** Include bridge runtime (default: true) */
  includeBridge?: boolean;
  /** Page title */
  title?: string;
  /** Custom shell template (pre-resolved object or inline string). */
  customShell?: ResolvedShellTemplate | string;
  /** Widget sizing configuration (height/aspect-ratio/auto-resize). */
  sizing?: WidgetSizing;
  /**
   * Pluggable inline-module mount tail. Default = the widget `McpBridgeProvider`
   * mount from `@frontmcp/ui/react`. See {@link ShellMountDescriptor}.
   */
  mount?: ShellMountDescriptor;
  /**
   * Pluggable injected window global. Default = the widget `window.__mcp*`
   * injection. See {@link ShellDataInjectionDescriptor}.
   */
  dataInjection?: ShellDataInjectionDescriptor;
}

/**
 * Widget sizing configuration injected into the shell document.
 *
 * Drives both the static sizing CSS (initial/min/max height, aspect-ratio) and
 * the runtime auto-resize behaviour (via `window.__mcpWidgetSizing`).
 */
export interface WidgetSizing {
  /** Preferred initial height (number → px, string → any CSS length). */
  preferredHeight?: number | string;
  /** Minimum height (number → px, string → any CSS length). */
  minHeight?: number | string;
  /** Maximum height (number → px, string → any CSS length). */
  maxHeight?: number | string;
  /** CSS aspect-ratio (e.g. `'16 / 9'` or `1.5`). */
  aspectRatio?: string | number;
  /** Whether the runtime auto-reports content height to the host. Default true. */
  autoResize?: boolean;
}

/**
 * Result of building an HTML shell.
 */
export interface ShellResult {
  /** Complete HTML output */
  html: string;
  /** SHA-256 hash of the HTML content (hex) */
  hash: string;
  /** Size in bytes */
  size: number;
}

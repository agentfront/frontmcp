/**
 * Component Types
 *
 * Polymorphic UI component loading — 4 source modes:
 * npm, file, import (URL), and inline function.
 *
 * @packageDocumentation
 */

// === SOURCE TYPES ===

/** Mode 1: NPM package — resolved via ImportResolver */
export interface NpmSource {
  npm: string;
  exportName?: string;
  version?: string;
}

/** Mode 2: File path — read at build time or served as URL */
export interface FileSource {
  file: string;
  inline?: boolean;
}

/** Mode 3: Direct URL import */
export interface ImportSource {
  import: string;
  exportName?: string;
}

/** Mode 4: Inline template function */
export type FunctionSource<In = unknown, Out = unknown> = (input: In, output: Out) => string;

/** Union of all UI source types */
export type UISource<In = unknown, Out = unknown> = NpmSource | FileSource | ImportSource | FunctionSource<In, Out>;

// === TYPE GUARDS ===

export function isNpmSource(source: UISource): source is NpmSource {
  return typeof source === 'object' && source !== null && 'npm' in source;
}

export function isFileSource(source: UISource): source is FileSource {
  return typeof source === 'object' && source !== null && 'file' in source;
}

export function isImportSource(source: UISource): source is ImportSource {
  return typeof source === 'object' && source !== null && 'import' in source;
}

export function isFunctionSource<In = unknown, Out = unknown>(
  source: UISource<In, Out>,
): source is FunctionSource<In, Out> {
  return typeof source === 'function';
}

// === COMPONENT CONFIG ===

/** Full UI configuration on a tool */
export interface UIConfig<In = unknown, Out = unknown> {
  /** The UI source (one of the 4 modes) */
  source: UISource<In, Out>;
  /** Explicit props mapping from output paths (default: spread output as props) */
  props?: Record<string, string>;
  /** Shell configuration overrides */
  withShell?: boolean;
  /** Include bridge runtime */
  includeBridge?: boolean;
  /** Custom shell template (pre-resolved object or inline string). */
  customShell?: import('../shell/custom-shell-types').ResolvedShellTemplate | string;
}

/** Auto-detected or declared metadata on a component module */
export interface ComponentMeta {
  /** Whether the component uses FrontMCP bridge internally */
  mcpAware: boolean;
  /** Rendering strategy */
  renderer: 'react' | 'html' | 'auto';
  /** Peer dependencies needed */
  peerDependencies?: string[];
}

/** Well-known export name for component metadata auto-detection */
export const FRONTMCP_META_KEY = '__frontmcp_meta';

/** Result of resolving a UI source */
export interface ResolvedComponent {
  /** How the component should be loaded */
  mode: 'module' | 'inline';
  /** For module mode: the URL to import */
  url?: string;
  /** For inline mode: the HTML content */
  html?: string;
  /** Export name for the component (default: 'default') */
  exportName: string;
  /** Detected metadata */
  meta: ComponentMeta;
  /** Peer dependencies that need to be loaded */
  peerDependencies: string[];
}

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

/**
 * IIFE Generator for FrontMcpBridge Runtime
 *
 * Generates vanilla JavaScript IIFE scripts that can be embedded
 * in HTML templates for runtime platform detection and bridge setup.
 *
 * @packageDocumentation
 */
/**
 * Options for generating the bridge IIFE.
 */
export interface IIFEGeneratorOptions {
  /** Include specific adapters (all if not specified) */
  adapters?: ('openai' | 'ext-apps' | 'claude' | 'gemini' | 'generic')[];
  /** Enable debug logging */
  debug?: boolean;
  /** Trusted origins for ext-apps adapter */
  trustedOrigins?: string[];
  /** Minify the output */
  minify?: boolean;
}
/**
 * Generate the bridge runtime IIFE script.
 *
 * This generates a self-contained vanilla JavaScript script that:
 * 1. Detects the current platform
 * 2. Initializes the appropriate adapter
 * 3. Exposes window.FrontMcpBridge global
 *
 * @example
 * ```typescript
 * import { generateBridgeIIFE } from '@frontmcp/ui/bridge';
 *
 * const script = generateBridgeIIFE({ debug: true });
 * const html = `<script>${script}</script>`;
 * ```
 */
export declare function generateBridgeIIFE(options?: IIFEGeneratorOptions): string;
/**
 * Generate platform-specific bundle IIFE.
 *
 * @example ChatGPT-specific bundle
 * ```typescript
 * const script = generatePlatformBundle('chatgpt');
 * ```
 */
export declare function generatePlatformBundle(
  platform: 'chatgpt' | 'claude' | 'gemini' | 'universal',
  options?: Omit<IIFEGeneratorOptions, 'adapters'>,
): string;
/**
 * Pre-generated universal bridge script (includes all adapters).
 * Use this for the simplest integration.
 */
export declare const UNIVERSAL_BRIDGE_SCRIPT: string;
/**
 * Pre-generated bridge scripts wrapped in script tags.
 */
export declare const BRIDGE_SCRIPT_TAGS: {
  universal: string;
  chatgpt: string;
  claude: string;
  gemini: string;
};
//# sourceMappingURL=iife-generator.d.ts.map

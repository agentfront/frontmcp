/**
 * Bridge Runtime Module
 *
 * Exports for generating runtime bridge scripts.
 * Re-exports from @frontmcp/uipack/bridge-runtime for compatibility.
 *
 * @packageDocumentation
 */

// Re-export from uipack - the IIFE generator is React-free
export {
  generateBridgeIIFE,
  generatePlatformBundle,
  UNIVERSAL_BRIDGE_SCRIPT,
  BRIDGE_SCRIPT_TAGS,
  type IIFEGeneratorOptions,
} from '@frontmcp/uipack';

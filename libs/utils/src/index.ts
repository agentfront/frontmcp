/**
 * @frontmcp/utils
 *
 * Shared utility functions for the FrontMCP ecosystem.
 * Provides generic, protocol-neutral utilities for string manipulation,
 * URI handling, path operations, content processing, and more.
 */

// Naming utilities
export { NameCase, splitWords, toCase, sepFor, shortHash, ensureMaxLen, idFromString } from './naming';

// URI utilities
export {
  isValidMcpUri,
  extractUriScheme,
  isValidMcpUriTemplate,
  ParsedUriTemplate,
  parseUriTemplate,
  matchUriTemplate,
  expandUriTemplate,
  extractTemplateParams,
  isUriTemplate,
} from './uri';

// Path utilities
export { trimSlashes, joinPath } from './path';

// Content utilities
export { sanitizeToJson, inferMimeType } from './content';

// HTTP utilities
export { validateBaseUrl } from './http';

// File system utilities
export { fileExists, readJSON, writeJSON, ensureDir, isDirEmpty, runCmd } from './fs';

// Escape utilities (HTML, JS, XSS prevention)
export { escapeHtml, escapeHtmlAttr, escapeJsString, escapeScriptClose, safeJsonForScript } from './escape';

// Serialization utilities
export { safeStringify } from './serialization';

// Crypto utilities (cross-platform: Node.js and browser)
export {
  getCrypto,
  randomUUID,
  randomBytes,
  sha256,
  sha256Hex,
  sha256Base64url,
  hmacSha256,
  hkdfSha256,
  encryptAesGcm,
  decryptAesGcm,
  timingSafeEqual,
  bytesToHex,
  base64urlEncode,
  base64urlDecode,
  isNode,
  isBrowser,
  assertNode,
  CryptoProvider,
  EncBlob,
} from './crypto';

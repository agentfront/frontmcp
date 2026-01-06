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

// File system utilities (Node.js only)
export {
  readFile,
  readFileBuffer,
  writeFile,
  mkdir,
  rename,
  unlink,
  stat,
  copyFile,
  cp,
  readdir,
  rm,
  mkdtemp,
  access,
  fileExists,
  readJSON,
  writeJSON,
  ensureDir,
  isDirEmpty,
  runCmd,
} from './fs';

// Escape utilities (HTML, JS, XSS prevention)
export { escapeHtml, escapeHtmlAttr, escapeJsString, escapeScriptClose, safeJsonForScript } from './escape';

// Serialization utilities
export { safeStringify } from './serialization';

// Crypto utilities (cross-platform: Node.js and browser)
// Includes: core crypto, encrypted blobs, PKCE (RFC 7636), secret persistence
export {
  // Core crypto
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
  // Encrypted blob helpers
  EncryptedBlob,
  EncryptedBlobError,
  encryptValue,
  decryptValue,
  tryDecryptValue,
  serializeBlob,
  deserializeBlob,
  tryDeserializeBlob,
  isValidEncryptedBlob,
  encryptAndSerialize,
  deserializeAndDecrypt,
  tryDeserializeAndDecrypt,
  // PKCE utilities (RFC 7636)
  generateCodeVerifier,
  generateCodeChallenge,
  verifyCodeChallenge,
  generatePkcePair,
  isValidCodeVerifier,
  isValidCodeChallenge,
  MIN_CODE_VERIFIER_LENGTH,
  MAX_CODE_VERIFIER_LENGTH,
  DEFAULT_CODE_VERIFIER_LENGTH,
  PkceError,
  type PkcePair,
  // Secret persistence utilities
  type SecretData,
  type SecretPersistenceOptions,
  type SecretValidationResult,
  secretDataSchema,
  validateSecretData,
  parseSecretData,
  isSecretPersistenceEnabled,
  resolveSecretPath,
  loadSecret,
  saveSecret,
  deleteSecret,
  generateSecret,
  createSecretData,
  getOrCreateSecret,
  clearCachedSecret,
  isSecretCached,
} from './crypto';

// Safe regex utilities (ReDoS prevention)
export {
  // Core safe regex functions
  analyzePattern,
  isPatternSafe,
  createSafeRegExp,
  safeTest,
  safeMatch,
  safeReplace,
  safeExec,
  isInputLengthSafe,
  DEFAULT_MAX_INPUT_LENGTH,
  REDOS_THRESHOLDS,
  // Pre-built safe pattern utilities
  trimLeading,
  trimTrailing,
  trimBoth,
  trimChars,
  extractBracedParams,
  expandTemplate,
  hasTemplatePlaceholders,
  collapseChar,
  collapseWhitespace,
  // Types
  type SafeRegexOptions,
  type PatternAnalysisResult,
} from './regex';

// Storage utilities (unified key-value storage with pluggable backends)
export {
  // Factory
  createStorage,
  createMemoryStorage,
  getDetectedStorageType,
  // Types
  StorageAdapter,
  NamespacedStorage,
  RootStorage,
  SetOptions,
  SetEntry,
  MessageHandler,
  Unsubscribe,
  MemoryAdapterOptions,
  RedisAdapterOptions,
  VercelKvAdapterOptions,
  UpstashAdapterOptions,
  StorageType,
  StorageConfig,
  // Namespace
  NamespacedStorageImpl,
  createRootStorage,
  createNamespacedStorage,
  buildPrefix,
  NAMESPACE_SEPARATOR,
  // Errors
  StorageError,
  StorageConnectionError,
  StorageOperationError,
  StorageNotSupportedError,
  StorageConfigError,
  StorageTTLError,
  StoragePatternError,
  StorageNotConnectedError,
  // Adapters
  BaseStorageAdapter,
  MemoryStorageAdapter,
  RedisStorageAdapter,
  VercelKvStorageAdapter,
  UpstashStorageAdapter,
  // Utilities
  globToRegex,
  matchesPattern,
  validatePattern,
  escapeGlob,
  MAX_TTL_SECONDS,
  validateTTL,
  validateOptionalTTL,
  ttlToExpiresAt,
  expiresAtToTTL,
  isExpired,
  normalizeTTL,
} from './storage';

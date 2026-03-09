/**
 * Smoke test for the cli-runtime barrel exports.
 * Ensures all re-exports resolve correctly.
 */

import {
  schemaToCommander,
  generateOptionCode,
  camelToKebab,
  formatToolResult,
  formatResourceResult,
  formatPromptResult,
  formatSubscriptionEvent,
  generateOutputFormatterSource,
  generateCredentialStoreSource,
  generateSessionManagerSource,
  extractSchemas,
  SYSTEM_TOOL_NAMES,
  generateCliEntry,
  resolveToolCommandName,
  extractTemplateParams,
  RESERVED_COMMANDS,
  generateOAuthHelperSource,
  generateDaemonClientSource,
  bundleCliWithEsbuild,
} from '../cli-runtime';

describe('cli-runtime barrel exports', () => {
  it('should export schema-to-commander functions', () => {
    expect(typeof schemaToCommander).toBe('function');
    expect(typeof generateOptionCode).toBe('function');
    expect(typeof camelToKebab).toBe('function');
  });

  it('should export output-formatter functions', () => {
    expect(typeof formatToolResult).toBe('function');
    expect(typeof formatResourceResult).toBe('function');
    expect(typeof formatPromptResult).toBe('function');
    expect(typeof formatSubscriptionEvent).toBe('function');
    expect(typeof generateOutputFormatterSource).toBe('function');
  });

  it('should export credential-store and session-manager generators', () => {
    expect(typeof generateCredentialStoreSource).toBe('function');
    expect(typeof generateSessionManagerSource).toBe('function');
  });

  it('should export schema-extractor functions and constants', () => {
    expect(typeof extractSchemas).toBe('function');
    expect(SYSTEM_TOOL_NAMES).toBeInstanceOf(Set);
    expect(SYSTEM_TOOL_NAMES.has('searchSkills')).toBe(true);
  });

  it('should export generate-cli-entry functions and constants', () => {
    expect(typeof generateCliEntry).toBe('function');
    expect(typeof resolveToolCommandName).toBe('function');
    expect(typeof extractTemplateParams).toBe('function');
    expect(RESERVED_COMMANDS).toBeInstanceOf(Set);
  });

  it('should export oauth-helper and daemon-client generators', () => {
    expect(typeof generateOAuthHelperSource).toBe('function');
    expect(typeof generateDaemonClientSource).toBe('function');
  });

  it('should export cli-bundler function', () => {
    expect(typeof bundleCliWithEsbuild).toBe('function');
  });
});

/**
 * Tests for error sanitization utilities
 */

import {
  sanitizeErrorMessage,
  sanitizeDocumentId,
  sanitizeFileError,
  sanitizeStorageError,
  GENERIC_ERROR_MESSAGES,
} from '../error.utils';

describe('Error Utilities', () => {
  describe('sanitizeErrorMessage', () => {
    it('should return error message in verbose mode with Error object', () => {
      const error = new Error('Detailed error message');
      const result = sanitizeErrorMessage(error, 'Generic error', true);

      expect(result).toBe('Detailed error message');
    });

    it('should return error message in verbose mode with string', () => {
      const result = sanitizeErrorMessage('Detailed error message', 'Generic error', true);

      expect(result).toBe('Detailed error message');
    });

    it('should return generic message in production mode with Error object', () => {
      const error = new Error('Detailed error message with sensitive info');
      const result = sanitizeErrorMessage(error, 'Generic error', false);

      expect(result).toBe('Generic error');
    });

    it('should return generic message in production mode with string', () => {
      const result = sanitizeErrorMessage('Detailed error with /path/to/file', 'Generic error', false);

      expect(result).toBe('Generic error');
    });

    it('should default to verbose mode when not specified', () => {
      const error = new Error('Test error');
      const result = sanitizeErrorMessage(error, 'Generic error');

      expect(result).toBe('Test error');
    });
  });

  describe('sanitizeDocumentId', () => {
    it('should return actual ID in verbose mode', () => {
      const result = sanitizeDocumentId('doc-12345-secret', true);

      expect(result).toBe('doc-12345-secret');
    });

    it('should return placeholder in production mode', () => {
      const result = sanitizeDocumentId('doc-12345-secret', false);

      expect(result).toBe('[document]');
    });

    it('should default to verbose mode when not specified', () => {
      const result = sanitizeDocumentId('doc-12345-secret');

      expect(result).toBe('doc-12345-secret');
    });
  });

  describe('sanitizeFileError', () => {
    it('should return detailed message in verbose mode with Error object', () => {
      const error = new Error('ENOENT: file not found /path/to/file.json');
      const result = sanitizeFileError('read', error, true);

      expect(result).toBe('Failed to read file: ENOENT: file not found /path/to/file.json');
    });

    it('should return detailed message in verbose mode with string', () => {
      const result = sanitizeFileError('write', 'Permission denied /path/to/file.json', true);

      expect(result).toBe('Failed to write file: Permission denied /path/to/file.json');
    });

    it('should return generic message in production mode with Error object', () => {
      const error = new Error('ENOENT: file not found /path/to/file.json');
      const result = sanitizeFileError('read', error, false);

      expect(result).toBe('Failed to read file');
    });

    it('should return generic message in production mode with string', () => {
      const result = sanitizeFileError('write', 'Permission denied', false);

      expect(result).toBe('Failed to write file');
    });

    it('should default to verbose mode when not specified', () => {
      const error = new Error('Test error');
      const result = sanitizeFileError('delete', error);

      expect(result).toBe('Failed to delete file: Test error');
    });

    it('should handle different operation names', () => {
      const error = new Error('Test');

      expect(sanitizeFileError('read', error, true)).toContain('read');
      expect(sanitizeFileError('write', error, true)).toContain('write');
      expect(sanitizeFileError('delete', error, true)).toContain('delete');
      expect(sanitizeFileError('move', error, true)).toContain('move');
    });
  });

  describe('sanitizeStorageError', () => {
    it('should return detailed message in verbose mode with Error object', () => {
      const error = new Error('Connection refused to redis://localhost:6379');
      const result = sanitizeStorageError('connection', error, true);

      expect(result).toBe('Storage connection failed: Connection refused to redis://localhost:6379');
    });

    it('should return detailed message in verbose mode with string', () => {
      const result = sanitizeStorageError('save', 'Timeout connecting to database', true);

      expect(result).toBe('Storage save failed: Timeout connecting to database');
    });

    it('should return generic message in production mode with Error object', () => {
      const error = new Error('Connection refused to redis://localhost:6379');
      const result = sanitizeStorageError('connection', error, false);

      expect(result).toBe('Storage operation failed');
    });

    it('should return generic message in production mode with string', () => {
      const result = sanitizeStorageError('save', 'Timeout connecting', false);

      expect(result).toBe('Storage operation failed');
    });

    it('should default to verbose mode when not specified', () => {
      const error = new Error('Test error');
      const result = sanitizeStorageError('load', error);

      expect(result).toBe('Storage load failed: Test error');
    });

    it('should handle different operation names', () => {
      const error = new Error('Test');

      expect(sanitizeStorageError('save', error, true)).toContain('save');
      expect(sanitizeStorageError('load', error, true)).toContain('load');
      expect(sanitizeStorageError('delete', error, true)).toContain('delete');
      expect(sanitizeStorageError('initialize', error, true)).toContain('initialize');
    });
  });

  describe('GENERIC_ERROR_MESSAGES', () => {
    it('should have all required generic error messages', () => {
      expect(GENERIC_ERROR_MESSAGES.VALIDATION_ERROR).toBe('Validation failed');
      expect(GENERIC_ERROR_MESSAGES.DOCUMENT_NOT_FOUND).toBe('Document not found');
      expect(GENERIC_ERROR_MESSAGES.DOCUMENT_EXISTS).toBe('Document already exists');
      expect(GENERIC_ERROR_MESSAGES.DUPLICATE_DOCUMENT).toBe('Duplicate document detected');
      expect(GENERIC_ERROR_MESSAGES.QUERY_ERROR).toBe('Query validation failed');
      expect(GENERIC_ERROR_MESSAGES.EMBEDDING_ERROR).toBe('Embedding generation failed');
      expect(GENERIC_ERROR_MESSAGES.STORAGE_ERROR).toBe('Storage operation failed');
      expect(GENERIC_ERROR_MESSAGES.NOT_INITIALIZED).toBe('Database not initialized');
      expect(GENERIC_ERROR_MESSAGES.CONFIGURATION_ERROR).toBe('Invalid configuration');
    });

    it('should be a constant object', () => {
      // Verify it's read-only (TypeScript const assertion)
      expect(Object.isFrozen(GENERIC_ERROR_MESSAGES)).toBe(false);
      // But we can verify the keys exist
      expect(Object.keys(GENERIC_ERROR_MESSAGES)).toHaveLength(9);
    });

    it('should have generic non-sensitive messages', () => {
      // Verify none of the messages contain sensitive patterns
      const messages = Object.values(GENERIC_ERROR_MESSAGES);

      messages.forEach((message) => {
        expect(message).not.toMatch(/\//); // No paths
        expect(message).not.toMatch(/\\/); // No paths
        expect(message).not.toMatch(/\d{2,}/); // No IDs or numbers
        expect(message).not.toMatch(/password|token|key|secret/i); // No sensitive keywords
      });
    });
  });

  describe('Production mode integration', () => {
    it('should consistently hide sensitive information across all utilities', () => {
      const sensitiveError = new Error('Failed to connect to redis://user:pass@localhost:6379/db');
      const sensitiveId = 'user-12345-email@example.com';

      expect(sanitizeErrorMessage(sensitiveError, 'Error', false)).toBe('Error');
      expect(sanitizeDocumentId(sensitiveId, false)).toBe('[document]');
      expect(sanitizeFileError('read', sensitiveError, false)).toBe('Failed to read file');
      expect(sanitizeStorageError('connect', sensitiveError, false)).toBe('Storage operation failed');
    });

    it('should reveal information in verbose mode for debugging', () => {
      const error = new Error('Detailed debug information');
      const id = 'doc-12345';

      expect(sanitizeErrorMessage(error, 'Error', true)).toContain('Detailed debug information');
      expect(sanitizeDocumentId(id, true)).toBe('doc-12345');
      expect(sanitizeFileError('read', error, true)).toContain('Detailed debug information');
      expect(sanitizeStorageError('connect', error, true)).toContain('Detailed debug information');
    });
  });
});

import { VectoriaDB } from '../vectoria';
import {
  VectoriaError,
  VectoriaNotInitializedError,
  DocumentValidationError,
  DocumentNotFoundError,
  DocumentExistsError,
  DuplicateDocumentError,
  QueryValidationError,
  EmbeddingError,
  ConfigurationError,
} from '../errors';
import type { DocumentMetadata } from '../interfaces';

interface TestMetadata extends DocumentMetadata {
  category: string;
}

describe('VectoriaDB Error Handling', () => {
  describe('Error Classes', () => {
    test('VectoriaError should have correct properties', () => {
      const error = new VectoriaError('Test message', 'TEST_CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Test message');
      expect(error.code).toBe('TEST_CODE');
      expect(error.name).toBe('VectoriaError');
    });

    test('VectoriaNotInitializedError should have correct properties', () => {
      const error = new VectoriaNotInitializedError('testing');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('VectoriaDB must be initialized before testing. Call initialize() first.');
      expect(error.code).toBe('NOT_INITIALIZED');
      expect(error.name).toBe('VectoriaNotInitializedError');
    });

    test('DocumentValidationError should have correct properties', () => {
      const error = new DocumentValidationError('Invalid document', 'doc-1');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Invalid document');
      expect(error.code).toBe('DOCUMENT_VALIDATION_ERROR');
      expect(error.documentId).toBe('doc-1');
      expect(error.name).toBe('DocumentValidationError');
    });

    test('DocumentNotFoundError should have correct properties', () => {
      const error = new DocumentNotFoundError('doc-1');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Document with id "doc-1" not found');
      expect(error.code).toBe('DOCUMENT_NOT_FOUND');
      expect(error.documentId).toBe('doc-1');
      expect(error.name).toBe('DocumentNotFoundError');
    });

    test('DocumentExistsError should have correct properties', () => {
      const error = new DocumentExistsError('doc-1');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toContain('already exists');
      expect(error.code).toBe('DOCUMENT_EXISTS');
      expect(error.documentId).toBe('doc-1');
      expect(error.name).toBe('DocumentExistsError');
    });

    test('DuplicateDocumentError should have correct properties for batch', () => {
      const error = new DuplicateDocumentError('doc-1', 'batch');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Duplicate document id "doc-1" in batch');
      expect(error.code).toBe('DUPLICATE_DOCUMENT');
      expect(error.documentId).toBe('doc-1');
      expect(error.context).toBe('batch');
    });

    test('DuplicateDocumentError should have correct properties for existing', () => {
      const error = new DuplicateDocumentError('doc-1', 'existing');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Document with id "doc-1" already exists');
      expect(error.code).toBe('DUPLICATE_DOCUMENT');
      expect(error.documentId).toBe('doc-1');
      expect(error.context).toBe('existing');
    });

    test('QueryValidationError should have correct properties', () => {
      const error = new QueryValidationError('Invalid query');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Invalid query');
      expect(error.code).toBe('QUERY_VALIDATION_ERROR');
      expect(error.name).toBe('QueryValidationError');
    });

    test('EmbeddingError should have correct properties', () => {
      const details = { count: 5 };
      const error = new EmbeddingError('Embedding failed', details);
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Embedding failed');
      expect(error.code).toBe('EMBEDDING_ERROR');
      expect(error.details).toEqual(details);
      expect(error.name).toBe('EmbeddingError');
    });

    test('ConfigurationError should have correct properties', () => {
      const error = new ConfigurationError('Invalid config');
      expect(error).toBeInstanceOf(VectoriaError);
      expect(error.message).toBe('Invalid config');
      expect(error.code).toBe('CONFIGURATION_ERROR');
      expect(error.name).toBe('ConfigurationError');
    });
  });

  describe('VectoriaDB Error Throwing', () => {
    describe('Not Initialized Errors', () => {
      test('should throw VectoriaNotInitializedError when adding before init', async () => {
        const db = new VectoriaDB<TestMetadata>();
        await expect(db.add('doc-1', 'test', { id: 'doc-1', category: 'test' })).rejects.toThrow(
          VectoriaNotInitializedError,
        );

        try {
          await db.add('doc-1', 'test', { id: 'doc-1', category: 'test' });
        } catch (error) {
          expect(error).toBeInstanceOf(VectoriaNotInitializedError);
          expect((error as VectoriaNotInitializedError).code).toBe('NOT_INITIALIZED');
        }
      });

      test('should throw VectoriaNotInitializedError when searching before init', async () => {
        const db = new VectoriaDB<TestMetadata>();
        await expect(db.search('test')).rejects.toThrow(VectoriaNotInitializedError);
      });

      test('should throw VectoriaNotInitializedError when updating before init', () => {
        const db = new VectoriaDB<TestMetadata>();
        expect(() => db.updateMetadata('doc-1', { id: 'doc-1', category: 'test' })).toThrow(
          VectoriaNotInitializedError,
        );
      });

      test('should throw VectoriaNotInitializedError when getting stats before init', () => {
        const db = new VectoriaDB<TestMetadata>();
        expect(() => db.getStats()).toThrow(VectoriaNotInitializedError);
      });

      test('should throw VectoriaNotInitializedError when saving before init', async () => {
        const db = new VectoriaDB<TestMetadata>();
        await expect(db.saveToStorage()).rejects.toThrow(VectoriaNotInitializedError);
      });
    });

    describe('Document Validation Errors', () => {
      let db: VectoriaDB<TestMetadata>;

      beforeEach(async () => {
        db = new VectoriaDB<TestMetadata>();
        await db.initialize();
      });

      test('should throw DocumentValidationError for empty text in add()', async () => {
        await expect(db.add('doc-1', '', { id: 'doc-1', category: 'test' })).rejects.toThrow(DocumentValidationError);

        try {
          await db.add('doc-1', '', { id: 'doc-1', category: 'test' });
        } catch (error) {
          expect(error).toBeInstanceOf(DocumentValidationError);
          expect((error as DocumentValidationError).documentId).toBe('doc-1');
          expect((error as DocumentValidationError).code).toBe('DOCUMENT_VALIDATION_ERROR');
        }
      });

      test('should throw DocumentValidationError for whitespace-only text', async () => {
        await expect(db.add('doc-1', '   ', { id: 'doc-1', category: 'test' })).rejects.toThrow(
          DocumentValidationError,
        );
      });

      test('should throw DocumentValidationError for metadata.id mismatch in add()', async () => {
        await expect(db.add('doc-1', 'test', { id: 'doc-2', category: 'test' })).rejects.toThrow(
          DocumentValidationError,
        );

        try {
          await db.add('doc-1', 'test', { id: 'doc-2', category: 'test' });
        } catch (error) {
          expect(error).toBeInstanceOf(DocumentValidationError);
          expect((error as DocumentValidationError).message).toContain('does not match');
        }
      });

      test('should throw DocumentValidationError for empty text in addMany()', async () => {
        await expect(
          db.addMany([
            { id: 'doc-1', text: 'valid', metadata: { id: 'doc-1', category: 'test' } },
            { id: 'doc-2', text: '', metadata: { id: 'doc-2', category: 'test' } },
          ]),
        ).rejects.toThrow(DocumentValidationError);
      });

      test('should throw DocumentValidationError for metadata.id mismatch in addMany()', async () => {
        await expect(
          db.addMany([{ id: 'doc-1', text: 'test', metadata: { id: 'doc-2', category: 'test' } }]),
        ).rejects.toThrow(DocumentValidationError);
      });

      test('should throw DocumentValidationError for empty text in update()', async () => {
        await db.add('doc-1', 'original', { id: 'doc-1', category: 'test' });
        await expect(db.update('doc-1', { text: '' })).rejects.toThrow(DocumentValidationError);
      });

      test('should throw DocumentValidationError for empty text in updateMany()', async () => {
        await db.add('doc-1', 'original', { id: 'doc-1', category: 'test' });
        await expect(db.updateMany([{ id: 'doc-1', text: '  ' }])).rejects.toThrow(DocumentValidationError);
      });
    });

    describe('Document Exists Errors', () => {
      let db: VectoriaDB<TestMetadata>;

      beforeEach(async () => {
        db = new VectoriaDB<TestMetadata>();
        await db.initialize();
        await db.add('existing', 'test', { id: 'existing', category: 'test' });
      });

      test('should throw DocumentExistsError when adding duplicate', async () => {
        await expect(db.add('existing', 'new text', { id: 'existing', category: 'test' })).rejects.toThrow(
          DocumentExistsError,
        );

        try {
          await db.add('existing', 'new text', { id: 'existing', category: 'test' });
        } catch (error) {
          expect(error).toBeInstanceOf(DocumentExistsError);
          expect((error as DocumentExistsError).documentId).toBe('existing');
          expect((error as DocumentExistsError).code).toBe('DOCUMENT_EXISTS');
        }
      });
    });

    describe('Duplicate Document Errors', () => {
      let db: VectoriaDB<TestMetadata>;

      beforeEach(async () => {
        db = new VectoriaDB<TestMetadata>();
        await db.initialize();
      });

      test('should throw DuplicateDocumentError for duplicate in batch', async () => {
        await expect(
          db.addMany([
            { id: 'doc-1', text: 'first', metadata: { id: 'doc-1', category: 'test' } },
            { id: 'doc-1', text: 'second', metadata: { id: 'doc-1', category: 'test' } },
          ]),
        ).rejects.toThrow(DuplicateDocumentError);

        try {
          await db.addMany([
            { id: 'doc-1', text: 'first', metadata: { id: 'doc-1', category: 'test' } },
            { id: 'doc-1', text: 'second', metadata: { id: 'doc-1', category: 'test' } },
          ]);
        } catch (error) {
          expect(error).toBeInstanceOf(DuplicateDocumentError);
          expect((error as DuplicateDocumentError).context).toBe('batch');
          expect((error as DuplicateDocumentError).documentId).toBe('doc-1');
        }
      });

      test('should throw DuplicateDocumentError for existing document in batch', async () => {
        await db.add('existing', 'test', { id: 'existing', category: 'test' });

        await expect(
          db.addMany([{ id: 'existing', text: 'new', metadata: { id: 'existing', category: 'test' } }]),
        ).rejects.toThrow(DuplicateDocumentError);

        try {
          await db.addMany([{ id: 'existing', text: 'new', metadata: { id: 'existing', category: 'test' } }]);
        } catch (error) {
          expect(error).toBeInstanceOf(DuplicateDocumentError);
          expect((error as DuplicateDocumentError).context).toBe('existing');
        }
      });
    });

    describe('Document Not Found Errors', () => {
      let db: VectoriaDB<TestMetadata>;

      beforeEach(async () => {
        db = new VectoriaDB<TestMetadata>();
        await db.initialize();
      });

      test('should throw DocumentNotFoundError in updateMetadata()', () => {
        expect(() => db.updateMetadata('nonexistent', { id: 'nonexistent', category: 'test' })).toThrow(
          DocumentNotFoundError,
        );

        try {
          db.updateMetadata('nonexistent', { id: 'nonexistent', category: 'test' });
        } catch (error) {
          expect(error).toBeInstanceOf(DocumentNotFoundError);
          expect((error as DocumentNotFoundError).documentId).toBe('nonexistent');
          expect((error as DocumentNotFoundError).code).toBe('DOCUMENT_NOT_FOUND');
        }
      });

      test('should throw DocumentNotFoundError in update()', async () => {
        await expect(db.update('nonexistent', { text: 'new' })).rejects.toThrow(DocumentNotFoundError);
      });

      test('should throw DocumentNotFoundError in updateMany()', async () => {
        await expect(db.updateMany([{ id: 'nonexistent', text: 'new' }])).rejects.toThrow(DocumentNotFoundError);
      });
    });

    describe('Query Validation Errors', () => {
      let db: VectoriaDB<TestMetadata>;

      beforeEach(async () => {
        db = new VectoriaDB<TestMetadata>();
        await db.initialize();
      });

      test('should throw QueryValidationError for empty query', async () => {
        await expect(db.search('')).rejects.toThrow(QueryValidationError);

        try {
          await db.search('');
        } catch (error) {
          expect(error).toBeInstanceOf(QueryValidationError);
          expect((error as QueryValidationError).code).toBe('QUERY_VALIDATION_ERROR');
          expect((error as QueryValidationError).message).toContain('empty');
        }
      });

      test('should throw QueryValidationError for whitespace-only query', async () => {
        await expect(db.search('   ')).rejects.toThrow(QueryValidationError);
      });

      test('should throw QueryValidationError for invalid topK', async () => {
        await expect(db.search('test', { topK: 0 })).rejects.toThrow(QueryValidationError);
        await expect(db.search('test', { topK: -5 })).rejects.toThrow(QueryValidationError);

        try {
          await db.search('test', { topK: 0 });
        } catch (error) {
          expect(error).toBeInstanceOf(QueryValidationError);
          expect((error as QueryValidationError).message).toContain('topK');
        }
      });

      test('should throw QueryValidationError for invalid threshold', async () => {
        await expect(db.search('test', { threshold: -0.1 })).rejects.toThrow(QueryValidationError);
        await expect(db.search('test', { threshold: 1.5 })).rejects.toThrow(QueryValidationError);

        try {
          await db.search('test', { threshold: 2.0 });
        } catch (error) {
          expect(error).toBeInstanceOf(QueryValidationError);
          expect((error as QueryValidationError).message).toContain('threshold');
        }
      });
    });

    describe('Error Catching by Type', () => {
      let db: VectoriaDB<TestMetadata>;

      beforeEach(async () => {
        db = new VectoriaDB<TestMetadata>();
        await db.initialize();
      });

      test('developers can catch specific error types', async () => {
        try {
          await db.add('doc-1', '', { id: 'doc-1', category: 'test' });
          fail('Should have thrown error');
        } catch (error) {
          if (error instanceof DocumentValidationError) {
            expect(error.code).toBe('DOCUMENT_VALIDATION_ERROR');
            expect(error.documentId).toBe('doc-1');
          } else {
            fail('Wrong error type');
          }
        }
      });

      test('developers can catch base VectoriaError', async () => {
        try {
          await db.search('');
          fail('Should have thrown error');
        } catch (error) {
          if (error instanceof VectoriaError) {
            expect(error.code).toBe('QUERY_VALIDATION_ERROR');
          } else {
            fail('Wrong error type');
          }
        }
      });

      test('developers can check error codes', async () => {
        await db.add('doc-1', 'test', { id: 'doc-1', category: 'test' });

        try {
          await db.add('doc-1', 'duplicate', { id: 'doc-1', category: 'test' });
        } catch (error) {
          if (error instanceof VectoriaError) {
            if (error.code === 'DOCUMENT_EXISTS') {
              // Handle duplicate document
              expect(true).toBe(true);
            }
          }
        }
      });
    });
  });
});

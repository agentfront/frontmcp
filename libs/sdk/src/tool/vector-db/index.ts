// Re-export from VectoriaDB
export * from '@frontmcp/vectoria';

// Tool-specific adapter
export * from './tool-vector-adapter';

// Legacy exports (deprecated - use VectoriaDB directly)
export * from './vector-db.interface';
export * from './vector-db.service';
export * from './embedding.service';
export * from './similarity.utils';
export * from './tool-vector-registry';

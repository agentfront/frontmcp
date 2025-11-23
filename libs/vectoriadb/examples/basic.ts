/**
 * Basic usage example of VectoriaDB
 */

import { VectoriaDB, DocumentMetadata } from '../src';

interface MyDocument extends DocumentMetadata {
  id: string;
  category: string;
  author: string;
  tags: string[];
}

async function basicExample() {
  console.log('=== VectoriaDB Basic Example ===\n');

  // 1. Create and initialize the database
  const db = new VectoriaDB<MyDocument>();
  await db.initialize();
  console.log('✓ Database initialized\n');

  // 2. Add some documents
  await db.addMany([
    {
      id: 'doc-1',
      text: 'How to create a user account in the system. Users can sign up with email and password.',
      metadata: {
        id: 'doc-1',
        category: 'auth',
        author: 'Alice',
        tags: ['user', 'authentication', 'account'],
      },
    },
    {
      id: 'doc-2',
      text: 'Send email notifications to users when important events occur in the application.',
      metadata: {
        id: 'doc-2',
        category: 'notifications',
        author: 'Bob',
        tags: ['email', 'notifications', 'alerts'],
      },
    },
    {
      id: 'doc-3',
      text: 'Upload files to cloud storage. Supports multiple file formats including images, documents, and videos.',
      metadata: {
        id: 'doc-3',
        category: 'storage',
        author: 'Charlie',
        tags: ['files', 'upload', 'cloud'],
      },
    },
    {
      id: 'doc-4',
      text: 'Delete user accounts from the system permanently. This action cannot be undone.',
      metadata: {
        id: 'doc-4',
        category: 'auth',
        author: 'Alice',
        tags: ['user', 'delete', 'account'],
      },
    },
  ]);
  console.log(`✓ Added ${db.size()} documents\n`);

  // 3. Basic semantic search
  console.log('--- Semantic Search ---\n');

  const queries = ['creating new accounts', 'sending messages to people', 'store documents', 'remove users'];

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    const results = await db.search(query, { topK: 2 });

    results.forEach((result, i) => {
      console.log(`  ${i + 1}. Score: ${result.score.toFixed(3)}`);
      console.log(`     Text: ${result.text.substring(0, 60)}...`);
      console.log(`     Category: ${result.metadata.category}`);
    });
    console.log();
  }

  // 4. Filtered search
  console.log('--- Filtered Search ---\n');

  console.log('Search "user management" in auth category only:');
  const authResults = await db.search('user management', {
    topK: 3,
    filter: (metadata) => metadata.category === 'auth',
  });

  authResults.forEach((result, i) => {
    console.log(`  ${i + 1}. ${result.text.substring(0, 50)}... (${result.score.toFixed(3)})`);
  });
  console.log();

  // 5. Complex filtering
  console.log('--- Complex Filtering ---\n');

  console.log('Documents by Alice with "user" tag:');
  const aliceUserDocs = db.filter((metadata) => metadata.author === 'Alice' && metadata.tags.includes('user'));

  aliceUserDocs.forEach((doc) => {
    console.log(`  - ${doc.text.substring(0, 50)}...`);
  });
  console.log();

  // 6. Statistics
  console.log('--- Database Statistics ---\n');
  const stats = db.getStats();
  console.log(`Total documents: ${stats.totalEmbeddings}`);
  console.log(`Vector dimensions: ${stats.dimensions}`);
  console.log(`Memory usage: ${(stats.estimatedMemoryBytes / 1024).toFixed(2)} KB`);
  console.log(`Model: ${stats.modelName}`);
  console.log();

  // 7. CRUD operations
  console.log('--- CRUD Operations ---\n');

  // Get a document
  const doc = db.get('doc-1');
  console.log(`Get doc-1: ${doc?.text.substring(0, 40)}...`);

  // Check if exists
  console.log(`Has doc-1: ${db.has('doc-1')}`);
  console.log(`Has doc-999: ${db.has('doc-999')}`);

  // Remove a document
  db.remove('doc-4');
  console.log(`After removing doc-4, size: ${db.size()}`);

  console.log('\n✓ Example completed successfully!');
}

// Run the example
if (require.main === module) {
  basicExample().catch(console.error);
}

export { basicExample };

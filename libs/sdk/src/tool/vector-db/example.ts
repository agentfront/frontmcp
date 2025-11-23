/**
 * Example usage of the Tool Vector Database
 *
 * This example demonstrates:
 * 1. Creating a vector database
 * 2. Adding tools with metadata
 * 3. Semantic search
 * 4. Filtering by appId, providerId, toolNames
 * 5. Integration with ToolRegistry
 */

import { ToolVectorDatabase } from './vector-db.service';
import { ToolVectorRegistry } from './tool-vector-registry';
import type { ToolData, ToolEmbeddingMetadata } from './vector-db.interface';

/**
 * Example 1: Basic usage with ToolVectorDatabase
 */
async function basicUsageExample() {
  console.log('=== Basic Usage Example ===\n');

  // 1. Create and initialize the vector database
  const vectorDb = new ToolVectorDatabase({
    modelName: 'Xenova/all-MiniLM-L6-v2', // default
    defaultTopK: 5,
    defaultSimilarityThreshold: 0.3,
  });

  await vectorDb.initialize();
  console.log('✓ Vector database initialized');

  // 2. Add some example tools
  const tools = [
    {
      id: 'tool-1',
      toolData: {
        name: 'create_user',
        description: 'Create a new user account in the system',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'User email address' },
            name: { type: 'string', description: 'Full name' },
            role: { type: 'string', description: 'User role' },
          },
        },
        outputSchema: { type: 'object' },
        tags: ['user', 'admin', 'account'],
      } as ToolData,
      metadata: {
        toolId: 'tool-1',
        toolName: 'create_user',
        appId: 'portal',
        providerId: 'auth-plugin',
        ownerKey: 'app:portal/plugin:auth',
      } as ToolEmbeddingMetadata,
    },
    {
      id: 'tool-2',
      toolData: {
        name: 'delete_user',
        description: 'Delete an existing user account from the system',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: 'User ID to delete' },
          },
        },
        outputSchema: { type: 'boolean' },
        tags: ['user', 'admin', 'account'],
      } as ToolData,
      metadata: {
        toolId: 'tool-2',
        toolName: 'delete_user',
        appId: 'portal',
        providerId: 'auth-plugin',
        ownerKey: 'app:portal/plugin:auth',
      } as ToolEmbeddingMetadata,
    },
    {
      id: 'tool-3',
      toolData: {
        name: 'send_email',
        description: 'Send an email notification to a user',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email content' },
          },
        },
        outputSchema: { type: 'boolean' },
        tags: ['email', 'notification', 'communication'],
      } as ToolData,
      metadata: {
        toolId: 'tool-3',
        toolName: 'send_email',
        appId: 'portal',
        providerId: 'notification-plugin',
        ownerKey: 'app:portal/plugin:notification',
      } as ToolEmbeddingMetadata,
    },
    {
      id: 'tool-4',
      toolData: {
        name: 'upload_file',
        description: 'Upload a file to cloud storage',
        inputSchema: {
          type: 'object',
          properties: {
            file: { type: 'string', description: 'File path' },
            bucket: { type: 'string', description: 'Storage bucket name' },
          },
        },
        outputSchema: { type: 'string' },
        tags: ['storage', 'file', 'upload'],
      } as ToolData,
      metadata: {
        toolId: 'tool-4',
        toolName: 'upload_file',
        appId: 'storage-app',
        providerId: 's3-plugin',
        ownerKey: 'app:storage/plugin:s3',
      } as ToolEmbeddingMetadata,
    },
  ];

  // Add tools in batch
  await vectorDb.addTools(tools);
  console.log(`✓ Added ${tools.length} tools to the database\n`);

  // 3. Semantic search
  console.log('--- Semantic Search Examples ---\n');

  const searchQueries = ['how to create a new account', 'send a message to someone', 'store files', 'remove a user'];

  for (const query of searchQueries) {
    console.log(`Query: "${query}"`);
    const results = await vectorDb.search(query, { topK: 2 });

    results.forEach((result, i) => {
      console.log(`  ${i + 1}. ${result.metadata.toolName} (score: ${result.score.toFixed(3)})`);
      console.log(`     ${result.text.substring(0, 80)}...`);
    });
    console.log();
  }

  // 4. Filtered search
  console.log('--- Filtered Search Examples ---\n');

  // Search only in auth-plugin
  console.log('Search "manage accounts" in auth-plugin only:');
  const authResults = await vectorDb.search('manage accounts', {
    filter: { providerId: 'auth-plugin' },
    topK: 3,
  });

  authResults.forEach((result, i) => {
    console.log(`  ${i + 1}. ${result.metadata.toolName} (score: ${result.score.toFixed(3)})`);
  });
  console.log();

  // Search only in portal app
  console.log('Search "notification" in portal app only:');
  const portalResults = await vectorDb.search('notification', {
    filter: { appId: 'portal' },
    topK: 3,
  });

  portalResults.forEach((result, i) => {
    console.log(`  ${i + 1}. ${result.metadata.toolName} (score: ${result.score.toFixed(3)})`);
  });
  console.log();

  // 5. Authorization-based filtering
  console.log('--- Authorization Example ---\n');

  // User is only authorized to use these tools
  const authorizedTools = ['create_user', 'send_email'];

  console.log(`User authorized for: ${authorizedTools.join(', ')}`);
  console.log('Search "create something" with authorization:');

  const authzResults = await vectorDb.search('create something', {
    filter: { toolNames: authorizedTools },
    topK: 3,
  });

  authzResults.forEach((result, i) => {
    console.log(`  ${i + 1}. ${result.metadata.toolName} (score: ${result.score.toFixed(3)})`);
  });
  console.log();

  // 6. Get statistics
  console.log('--- Database Statistics ---\n');
  const stats = vectorDb.getStats();
  console.log(`Total embeddings: ${stats.totalEmbeddings}`);
  console.log(`Vector dimensions: ${stats.dimensions}`);
  console.log(`Estimated memory: ${(stats.estimatedMemoryBytes / 1024).toFixed(2)} KB`);
  console.log(`Model: ${stats.modelName}`);
  console.log('\nBreakdown by App:');
  Object.entries(stats.breakdown.byAppId).forEach(([appId, count]) => {
    console.log(`  ${appId}: ${count} tools`);
  });
  console.log('\nBreakdown by Provider:');
  Object.entries(stats.breakdown.byProviderId).forEach(([providerId, count]) => {
    console.log(`  ${providerId}: ${count} tools`);
  });
}

/**
 * Example 2: Integration with ToolRegistry
 */
async function registryIntegrationExample() {
  console.log('\n\n=== ToolRegistry Integration Example ===\n');

  // Assuming you have a ToolRegistry instance
  // const registry = new ToolRegistry(...);

  // Create vector registry
  // const vectorRegistry = new ToolVectorRegistry(registry, {
  //   modelName: 'Xenova/all-MiniLM-L6-v2',
  //   autoSync: true, // Auto-sync when tools are added/removed
  // });

  // await vectorRegistry.initialize();
  // console.log('✓ Vector registry initialized and synced');

  // // Semantic search that returns ToolInstance objects
  // const results = await vectorRegistry.searchTools('create user account', {
  //   topK: 5,
  // });

  // results.forEach((result, i) => {
  //   console.log(
  //     `${i + 1}. ${result.tool.metadata.name} (score: ${result.score.toFixed(3)})`,
  //   );
  // });

  // // Get tools by filter
  // const authTools = vectorRegistry.getToolsByFilter({
  //   providerId: 'auth-plugin',
  // });

  // console.log(`\nFound ${authTools.length} auth tools`);

  // // Stats
  // const stats = vectorRegistry.getStats();
  // console.log(`\nTotal tools indexed: ${stats.totalEmbeddings}`);

  console.log('(See code comments for ToolRegistry integration example)');
}

/**
 * Example 3: Advanced filtering combinations
 */
async function advancedFilteringExample() {
  console.log('\n\n=== Advanced Filtering Example ===\n');

  const vectorDb = new ToolVectorDatabase();
  await vectorDb.initialize();

  // Add diverse tools
  const tools = [
    {
      id: 'tool-a1',
      toolData: {
        name: 'list_users',
        description: 'List all users in the organization',
        tags: ['user', 'admin', 'read'],
      } as ToolData,
      metadata: {
        toolId: 'tool-a1',
        toolName: 'list_users',
        appId: 'crm',
        providerId: 'user-mgmt',
        tags: ['user', 'admin', 'read'],
      } as ToolEmbeddingMetadata,
    },
    {
      id: 'tool-a2',
      toolData: {
        name: 'create_ticket',
        description: 'Create a support ticket',
        tags: ['support', 'ticket', 'create'],
      } as ToolData,
      metadata: {
        toolId: 'tool-a2',
        toolName: 'create_ticket',
        appId: 'crm',
        providerId: 'support',
        tags: ['support', 'ticket', 'create'],
      } as ToolEmbeddingMetadata,
    },
    {
      id: 'tool-a3',
      toolData: {
        name: 'export_data',
        description: 'Export user data to CSV',
        tags: ['user', 'export', 'data'],
      } as ToolData,
      metadata: {
        toolId: 'tool-a3',
        toolName: 'export_data',
        appId: 'analytics',
        providerId: 'reporting',
        tags: ['user', 'export', 'data'],
      } as ToolEmbeddingMetadata,
    },
  ];

  await vectorDb.addTools(tools);

  // Combine multiple filters
  console.log('Search with multiple filters:');
  console.log('- appId: crm');
  console.log('- tags: user OR admin\n');

  const results = await vectorDb.search('manage users', {
    filter: {
      appId: 'crm',
      tags: ['user', 'admin'],
    },
    topK: 3,
  });

  results.forEach((result, i) => {
    console.log(`${i + 1}. ${result.metadata.toolName} (${result.metadata.appId}/${result.metadata.providerId})`);
    console.log(`   Score: ${result.score.toFixed(3)}`);
    console.log(`   Tags: ${result.metadata.tags?.join(', ')}`);
  });
}

/**
 * Run all examples
 */
async function runExamples() {
  try {
    await basicUsageExample();
    await registryIntegrationExample();
    await advancedFilteringExample();

    console.log('\n✓ All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Uncomment to run:
// runExamples();

export { basicUsageExample, registryIntegrationExample, advancedFilteringExample, runExamples };

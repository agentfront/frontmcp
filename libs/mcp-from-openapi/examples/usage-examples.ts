import { OpenAPIToolGenerator } from '../src';
import type {  OperationWithContext } from '../src';

/**
 * Example 1: Basic usage with a simple OpenAPI spec
 */
async function basicExample() {
  console.log('=== Basic Example ===\n');

  const generator = await OpenAPIToolGenerator.fromURL(
    'https://petstore3.swagger.io/api/v3/openapi.json'
  );

  const tools = await generator.generateTools();
  console.log(`Generated ${tools.length} tools`);

  // Print first tool
  if (tools.length > 0) {
    const tool = tools[0];
    console.log('\nFirst tool:');
    console.log(`Name: ${tool.name}`);
    console.log(`Description: ${tool.description}`);
    console.log(`Input schema properties:`, Object.keys(tool.inputSchema.properties || {}));
    console.log(`Mapper entries:`, tool.mapper.length);
  }
}

/**
 * Example 2: Handling parameter conflicts
 */
async function conflictResolutionExample() {
  console.log('\n=== Conflict Resolution Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Example API', version: '1.0.0' },
    paths: {
      '/users/{id}': {
        post: {
          operationId: 'updateUser',
          summary: 'Update user with conflicting ID parameters',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              description: 'User ID in path',
              schema: { type: 'string' },
            },
            {
              name: 'id',
              in: 'query',
              description: 'Optional query ID for tracking',
              schema: { type: 'string' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Internal user ID' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);
  const tool = await generator.generateTool('/users/{id}', 'post');

  console.log('Tool:', tool.name);
  console.log('\nParameter mapping (conflict resolution):');
  tool.mapper.forEach((m) => {
    console.log(`  ${m.inputKey} -> ${m.type}.${m.key} (required: ${m.required})`);
  });

  console.log('\nInput schema properties:');
  Object.entries(tool.inputSchema.properties || {}).forEach(([key, schema]) => {
    console.log(`  ${key}: ${(schema as any).type} - ${(schema as any).description || 'N/A'}`);
  });
}

/**
 * Example 3: Custom naming strategy
 */
async function customNamingExample() {
  console.log('\n=== Custom Naming Strategy Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Example API', version: '1.0.0' },
    paths: {
      '/products/{id}': {
        get: {
          operationId: 'getProduct',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'fields',
              in: 'query',
              schema: { type: 'array', items: { type: 'string' } },
            },
          ],
          responses: {
            '200': { description: 'Success' },
          },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);

  // Custom naming strategy
  const tool = await generator.generateTool('/products/{id}', 'get', {
    namingStrategy: {
      conflictResolver: (paramName, location, index) => {
        // Use uppercase location prefix
        const prefix = location.toUpperCase();
        return `${prefix}_${paramName}`;
      },
      toolNameGenerator: (path, method, operationId) => {
        // Create descriptive names
        if (operationId) return operationId;
        const action = method.toLowerCase();
        const resource = path.split('/').filter(Boolean).join('_');
        return `${action}_${resource}`;
      },
    },
  });

  console.log('Generated tool name:', tool.name);
  console.log('\nParameter names with custom strategy:');
  tool.mapper.forEach((m) => {
    console.log(`  ${m.inputKey} (${m.type})`);
  });
}

/**
 * Example 4: Working with multiple response schemas
 */
async function multipleResponsesExample() {
  console.log('\n=== Multiple Responses Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Example API', version: '1.0.0' },
    paths: {
      '/users/{id}': {
        get: {
          operationId: 'getUser',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'User found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                },
              },
            },
            '404': {
              description: 'User not found',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                      code: { type: 'string' },
                    },
                  },
                },
              },
            },
            '401': {
              description: 'Unauthorized',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      message: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);

  // Include all responses
  const toolWithAll = await generator.generateTool('/users/{id}', 'get', {
    includeAllResponses: true,
  });

  console.log('Output schema with all responses:');
  console.log(`  Type: ${toolWithAll.outputSchema?.oneOf ? 'union (oneOf)' : 'single'}`);
  if (toolWithAll.outputSchema?.oneOf) {
    console.log(`  Number of variants: ${toolWithAll.outputSchema.oneOf.length}`);
    toolWithAll.outputSchema.oneOf.forEach((schema: any, i: number) => {
      console.log(`  Variant ${i + 1}: Status ${schema['x-status-code']}`);
    });
  }

  // Only preferred response
  const toolPreferred = await generator.generateTool('/users/{id}', 'get', {
    includeAllResponses: false,
    preferredStatusCodes: [200],
  });

  console.log('\nOutput schema with preferred response only:');
  console.log(`  Status code: ${(toolPreferred.outputSchema as any)['x-status-code']}`);
  console.log(`  Properties:`, Object.keys(toolPreferred.outputSchema?.properties || {}));
}

/**
 * Example 5: Authentication handling
 */
async function authenticationExample() {
  console.log('\n=== Authentication Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Secure API', version: '1.0.0' },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        apiKey: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/protected': {
        get: {
          operationId: 'getProtected',
          security: [{ apiKey: [] }],
          responses: {
            '200': { description: 'Success' },
          },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);
  const tool = await generator.generateTool('/protected', 'get');

  console.log('Security requirements:');
  tool.metadata.security?.forEach((sec) => {
    console.log(`  Scheme: ${sec.scheme}`);
    console.log(`  Type: ${sec.type}`);
    if (sec.name) console.log(`  Parameter name: ${sec.name}`);
    if (sec.in) console.log(`  Parameter location: ${sec.in}`);
  });
}

/**
 * Example 6: Filtering operations
 */
async function filteringExample() {
  console.log('\n=== Filtering Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Example API', version: '1.0.0' },
    paths: {
      '/users': {
        get: {
          operationId: 'listUsers',
          tags: ['users'],
          responses: { '200': { description: 'Success' } },
        },
        post: {
          operationId: 'createUser',
          tags: ['users'],
          responses: { '201': { description: 'Created' } },
        },
      },
      '/products': {
        get: {
          operationId: 'listProducts',
          tags: ['products'],
          responses: { '200': { description: 'Success' } },
        },
        delete: {
          operationId: 'deleteProduct',
          tags: ['products'],
          deprecated: true,
          responses: { '204': { description: 'Deleted' } },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);

  // Filter by operation IDs
  const specificTools = await generator.generateTools({
    includeOperations: ['listUsers', 'listProducts'],
  });
  console.log('Tools with specific operation IDs:', specificTools.map((t) => t.name));

  // Filter by custom function (only GET methods)
  const getTools = await generator.generateTools({
    filterFn: (op: OperationWithContext) => op.method === 'get',
  });
  console.log('GET-only tools:', getTools.map((t) => t.name));

  // Exclude deprecated
  const nonDeprecated = await generator.generateTools({
    includeDeprecated: false,
  });
  console.log('Non-deprecated tools:', nonDeprecated.map((t) => t.name));
}

/**
 * Example 7: Integration with Zod (pseudo-code)
 */
async function zodIntegrationExample() {
  console.log('\n=== Zod Integration Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Example API', version: '1.0.0' },
    paths: {
      '/users': {
        post: {
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    email: { type: 'string', format: 'email' },
                    age: { type: 'integer', minimum: 0 },
                  },
                  required: ['name', 'email'],
                },
              },
            },
          },
          responses: {
            '201': { description: 'Created' },
          },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);
  const tool = await generator.generateTool('/users', 'post');

  console.log('Input schema ready for Zod conversion:');
  console.log(JSON.stringify(tool.inputSchema, null, 2));

  console.log('\n// Pseudo-code for Zod conversion:');
  console.log('// import { zodSchema } from "json-schema-to-zod";');
  console.log('// const inputValidator = zodSchema(tool.inputSchema);');
  console.log('// const result = inputValidator.parse(data);');
}

/**
 * Example 8: Request mapping
 */
async function requestMappingExample() {
  console.log('\n=== Request Mapping Example ===\n');

  const openapi = {
    openapi: '3.0.0',
    info: { title: 'Example API', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com' }],
    paths: {
      '/users/{userId}/posts/{postId}': {
        get: {
          operationId: 'getUserPost',
          parameters: [
            {
              name: 'userId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'postId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
            {
              name: 'include',
              in: 'query',
              schema: { type: 'array', items: { type: 'string' } },
            },
            {
              name: 'Authorization',
              in: 'header',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Success' },
          },
        },
      },
    },
  };

  const generator = await OpenAPIToolGenerator.fromJSON(openapi);
  const tool = await generator.generateTool('/users/{userId}/posts/{postId}', 'get');

  console.log('How to construct a request from tool definition:\n');

  // Example input
  const input = {
    userId: '123',
    postId: '456',
    include: ['comments', 'likes'],
    Authorization: 'Bearer token123',
  };

  console.log('Input:', input);
  console.log('\nMapping to HTTP request:');

  // Build request
  let path = tool.metadata.path;
  const queryParams: Record<string, any> = {};
  const headers: Record<string, string> = {};

  tool.mapper.forEach((m) => {
    const value = (input as any)[m.inputKey];
    if (value === undefined) return;

    switch (m.type) {
      case 'path':
        path = path.replace(`{${m.key}}`, encodeURIComponent(value));
        console.log(`  Path param: {${m.key}} = ${value}`);
        break;
      case 'query':
        queryParams[m.key] = value;
        console.log(`  Query param: ${m.key} = ${JSON.stringify(value)}`);
        break;
      case 'header':
        headers[m.key] = value;
        console.log(`  Header: ${m.key} = ${value}`);
        break;
    }
  });

  const baseUrl = tool.metadata.servers?.[0]?.url || '';
  const queryString = new URLSearchParams(queryParams).toString();
  const fullUrl = `${baseUrl}${path}${queryString ? '?' + queryString : ''}`;

  console.log(`\nFinal request:`);
  console.log(`  ${tool.metadata.method.toUpperCase()} ${fullUrl}`);
  console.log(`  Headers:`, headers);
}

// Run all examples
async function runAllExamples() {
  try {
    await basicExample();
    await conflictResolutionExample();
    await customNamingExample();
    await multipleResponsesExample();
    await authenticationExample();
    await filteringExample();
    await zodIntegrationExample();
    await requestMappingExample();
  } catch (error) {
    console.error('Error running examples:', error);
  }
}

// Export for use
export {
  basicExample,
  conflictResolutionExample,
  customNamingExample,
  multipleResponsesExample,
  authenticationExample,
  filteringExample,
  zodIntegrationExample,
  requestMappingExample,
  runAllExamples,
};

// Run if executed directly
if (require.main === module) {
  runAllExamples();
}

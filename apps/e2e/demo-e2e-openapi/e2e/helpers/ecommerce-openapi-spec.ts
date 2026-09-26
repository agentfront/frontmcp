/** The e-commerce spec the demo-e2e-openapi server loads, served locally by MockAPIServer. */
export const ECOMMERCE_OPENAPI_SPEC = {
  openapi: '3.0.0',
  info: { title: 'E-commerce API', version: '1.0.0' },
  paths: {
    '/products': {
      get: {
        operationId: 'listProducts',
        summary: 'List all products',
        responses: {
          '200': {
            description: 'Product list',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      price: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/products/{id}': {
      get: {
        operationId: 'getProduct',
        summary: 'Get product by ID',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Product details',
          },
        },
      },
    },
    '/auth/register': {
      post: {
        operationId: 'registerUser',
        summary: 'Register a new user',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'User created' },
        },
      },
    },
  },
};

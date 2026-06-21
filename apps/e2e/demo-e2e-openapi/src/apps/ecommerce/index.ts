import { App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';
import CatalogResource from './resources/catalog.resource';
import ProductRecommendationPrompt from './prompts/product-recommendation.prompt';

// The OpenAPI URL can be configured via environment variable for testing
// In tests, a MockAPIServer serves the OpenAPI spec and mock responses
const apiBaseUrl = process.env['OPENAPI_BASE_URL'] || 'https://frontmcp-test.proxy.beeceptor.com';
const openapiUrl = process.env['OPENAPI_SPEC_URL'] || `${apiBaseUrl}/openapi.json`;

@App({
  name: 'E-commerce',
  description: 'E-commerce API via OpenAPI adapter for E2E testing',
  adapters: [
    OpenapiAdapter.init({
      name: 'ecommerce-api',
      url: openapiUrl,
      baseUrl: apiBaseUrl,
      // E2E tests serve the spec from a MockAPIServer on http://localhost:<port>.
      // mcp-from-openapi (>= 2.5.0) DNS-resolves the spec URL and blocks internal
      // addresses by default (SSRF guard), so we must opt back into loopback here.
      // Keep allowedProtocols: [] to preserve the adapter's secure default of
      // disabling external $ref resolution.
      loadOptions: {
        refResolution: {
          allowedProtocols: [],
          allowInternalIPs: true,
        },
      },
      generateOptions: {
        includeSecurityInInput: true,
      },
    }),
  ],
  resources: [CatalogResource],
  prompts: [ProductRecommendationPrompt],
})
export class EcommerceApp {}

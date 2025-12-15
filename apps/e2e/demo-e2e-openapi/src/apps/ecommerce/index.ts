import { App } from '@frontmcp/sdk';
import { OpenapiAdapter } from '@frontmcp/adapters';
import CatalogResource from './resources/catalog.resource';
import ProductRecommendationPrompt from './prompts/product-recommendation.prompt';

@App({
  name: 'E-commerce',
  description: 'E-commerce API via OpenAPI adapter for E2E testing',
  adapters: [
    OpenapiAdapter.init({
      name: 'ecommerce-api',
      url: 'https://frontmcp-test.proxy.beeceptor.com/openapi.json',
      baseUrl: 'https://frontmcp-test.proxy.beeceptor.com',
      generateOptions: {
        includeSecurityInInput: true,
      },
    }),
  ],
  resources: [CatalogResource],
  prompts: [ProductRecommendationPrompt],
})
export class EcommerceApp {}

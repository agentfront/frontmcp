import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';

const outputSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
    }),
  ),
  featuredProducts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      price: z.number(),
    }),
  ),
});

type CatalogOutput = z.infer<typeof outputSchema>;

@Resource({
  uri: 'ecommerce://catalog',
  name: 'Product Catalog',
  description: 'Overview of product categories and featured products',
  mimeType: 'application/json',
})
export default class CatalogResource extends ResourceContext<Record<string, never>, CatalogOutput> {
  async execute(): Promise<CatalogOutput> {
    // Static catalog data for testing
    return {
      categories: [
        { id: 'electronics', name: 'Electronics', description: 'Gadgets and devices' },
        { id: 'clothing', name: 'Clothing', description: 'Fashion and apparel' },
        { id: 'home', name: 'Home & Garden', description: 'Home improvement and decor' },
      ],
      featuredProducts: [
        { id: 'prod-1', name: 'Wireless Headphones', price: 79.99 },
        { id: 'prod-2', name: 'Smart Watch', price: 199.99 },
        { id: 'prod-3', name: 'Portable Charger', price: 29.99 },
      ],
    };
  }
}

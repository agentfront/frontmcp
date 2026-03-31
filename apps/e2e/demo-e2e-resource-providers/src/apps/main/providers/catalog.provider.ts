import { Provider, ProviderScope } from '@frontmcp/sdk';

/**
 * Simple catalog service for testing resource argument completion.
 * Provides searchable lists of categories and products.
 */
@Provider({
  name: 'CatalogService',
  scope: ProviderScope.GLOBAL,
})
export class CatalogService {
  private readonly categories = ['electronics', 'books', 'clothing', 'food', 'furniture'];

  private readonly products: Record<string, string[]> = {
    electronics: ['laptop', 'phone', 'tablet', 'headphones', 'monitor'],
    books: ['fiction', 'non-fiction', 'science', 'history', 'poetry'],
    clothing: ['shirt', 'pants', 'jacket', 'shoes', 'hat'],
    food: ['pizza', 'pasta', 'salad', 'soup', 'sandwich'],
    furniture: ['desk', 'chair', 'table', 'bookshelf', 'couch'],
  };

  searchCategories(partial: string): string[] {
    return this.categories.filter((c) => c.toLowerCase().includes(partial.toLowerCase()));
  }

  searchProducts(category: string, partial: string): string[] {
    const items = this.products[category] ?? [];
    return items.filter((p) => p.toLowerCase().includes(partial.toLowerCase()));
  }

  getAllCategories(): string[] {
    return [...this.categories];
  }

  getProducts(category: string): string[] {
    return this.products[category] ?? [];
  }
}

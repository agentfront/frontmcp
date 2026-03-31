import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import type { ResourceArgumentCompleter, ResourceCompletionResult } from '@frontmcp/sdk';
import { CatalogService } from '../providers/catalog.provider';

/**
 * Resource template with override-based completer.
 * Uses getArgumentCompleter() override to provide autocompletion for multiple params.
 */
@ResourceTemplate({
  name: 'product-detail',
  uriTemplate: 'catalog://{categoryName}/products/{productName}',
  description: 'Get product details',
  mimeType: 'application/json',
})
export default class ProductDetailResource extends ResourceContext<{
  categoryName: string;
  productName: string;
}> {
  async execute(uri: string, params: { categoryName: string; productName: string }) {
    const catalog = this.get(CatalogService);
    const products = catalog.getProducts(params.categoryName);
    const found = products.includes(params.productName);

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            category: params.categoryName,
            product: params.productName,
            found,
            allProducts: products,
          }),
        },
      ],
    };
  }

  /**
   * Override-based completer: handles multiple arguments via getArgumentCompleter.
   */
  getArgumentCompleter(argName: string): ResourceArgumentCompleter | null {
    if (argName === 'categoryName') {
      return async (partial: string): Promise<ResourceCompletionResult> => {
        const catalog = this.get(CatalogService);
        const values = catalog.searchCategories(partial);
        return { values, total: values.length };
      };
    }

    if (argName === 'productName') {
      return async (partial: string): Promise<ResourceCompletionResult> => {
        const catalog = this.get(CatalogService);
        // Complete across all categories since we don't have the category context
        const allProducts = catalog
          .getAllCategories()
          .flatMap((cat) => catalog.getProducts(cat))
          .filter((p) => p.toLowerCase().includes(partial.toLowerCase()));
        const unique = [...new Set(allProducts)];
        return { values: unique, total: unique.length, hasMore: false };
      };
    }

    return null;
  }
}

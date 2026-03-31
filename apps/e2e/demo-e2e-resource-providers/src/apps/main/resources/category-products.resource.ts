import { ResourceTemplate, ResourceContext } from '@frontmcp/sdk';
import type { ResourceCompletionResult } from '@frontmcp/sdk';
import { CatalogService } from '../providers/catalog.provider';

/**
 * Resource template with convention-based completer.
 * Uses the ${argName}Completer pattern to provide autocompletion for categoryName.
 */
@ResourceTemplate({
  name: 'category-products',
  uriTemplate: 'catalog://{categoryName}/products',
  description: 'List products in a category',
  mimeType: 'application/json',
})
export default class CategoryProductsResource extends ResourceContext<{ categoryName: string }> {
  async execute(uri: string, params: { categoryName: string }) {
    const catalog = this.get(CatalogService);
    const products = catalog.getProducts(params.categoryName);

    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ category: params.categoryName, products }),
        },
      ],
    };
  }

  /**
   * Convention-based completer: categoryNameCompleter
   * The framework discovers this automatically from the method name.
   */
  async categoryNameCompleter(partial: string): Promise<ResourceCompletionResult> {
    const catalog = this.get(CatalogService);
    const values = catalog.searchCategories(partial);
    return { values, total: values.length };
  }
}

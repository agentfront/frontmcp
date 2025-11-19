import { Adapter, DynamicAdapter, FrontMcpAdapterResponse } from '@frontmcp/sdk';
import { OpenApiAdapterOptions } from './openapi.types';
import { OpenAPIToolGenerator } from 'mcp-from-openapi';
import { createOpenApiTool } from './openapi.tool';

@Adapter({
  name: 'openapi',
  description: 'OpenAPI adapter for FrontMCP - Automatically generates MCP tools from OpenAPI specifications',
})
export default class OpenapiAdapter extends DynamicAdapter<OpenApiAdapterOptions> {
  private generator?: OpenAPIToolGenerator;
  public options: OpenApiAdapterOptions;

  constructor(options: OpenApiAdapterOptions) {
    super();
    this.options = options;
  }

  async fetch(): Promise<FrontMcpAdapterResponse> {
    // Lazy load: Initialize generator on first fetch if not already initialized
    if (!this.generator) {
      this.generator = await this.initializeGenerator();
    }

    // Generate tools from OpenAPI spec
    const openapiTools = await this.generator.generateTools({
      includeOperations: this.options.generateOptions?.includeOperations,
      excludeOperations: this.options.generateOptions?.excludeOperations,
      filterFn: this.options.generateOptions?.filterFn,
      namingStrategy: this.options.generateOptions?.namingStrategy,
      preferredStatusCodes: this.options.generateOptions?.preferredStatusCodes ?? [200, 201, 202, 204],
      includeDeprecated: this.options.generateOptions?.includeDeprecated ?? false,
      includeAllResponses: this.options.generateOptions?.includeAllResponses ?? true,
      includeSecurityInInput: this.options.generateOptions?.includeSecurityInInput ?? false,
      maxSchemaDepth: this.options.generateOptions?.maxSchemaDepth,
      includeExamples: this.options.generateOptions?.includeExamples,
    });

    // Convert OpenAPI tools to FrontMCP tools
    const tools = openapiTools.map((openapiTool) =>
      createOpenApiTool(openapiTool, this.options)
    );

    return { tools };
  }

  /**
   * Initialize the OpenAPI tool generator from URL or spec
   * @private
   */
  private async initializeGenerator(): Promise<OpenAPIToolGenerator> {
    if ('url' in this.options) {
      return await OpenAPIToolGenerator.fromURL(this.options.url, {
        baseUrl: this.options.baseUrl,
        validate: this.options.loadOptions?.validate ?? true,
        dereference: this.options.loadOptions?.dereference ?? true,
        headers: this.options.loadOptions?.headers,
        timeout: this.options.loadOptions?.timeout,
        followRedirects: this.options.loadOptions?.followRedirects,
      });
    } else if ('spec' in this.options) {
      return await OpenAPIToolGenerator.fromJSON(this.options.spec, {
        baseUrl: this.options.baseUrl,
        validate: this.options.loadOptions?.validate ?? true,
        dereference: this.options.loadOptions?.dereference ?? true,
      });
    } else {
      throw new Error('Either url or spec must be provided in OpenApiAdapterOptions');
    }
  }
}

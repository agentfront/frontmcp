import { Adapter, DynamicAdapter, FrontMcpAdapterResponse } from '@frontmcp/sdk';
import { OpenApiAdapterOptions } from './openapi.types';
import { OpenAPIToolGenerator } from 'mcp-from-openapi';
import { createOpenApiTool } from './openapi.tool';
import { validateSecurityConfiguration } from './openapi.security';

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

    // Validate security configuration
    const validation = validateSecurityConfiguration(openapiTools, this.options);

    // Log security information
    console.log(`\n[OpenAPI Adapter: ${this.options.name}] Security Analysis:`);
    console.log(`  Security Risk Score: ${validation.securityRiskScore.toUpperCase()}`);
    console.log(`  Valid Configuration: ${validation.valid ? 'YES' : 'NO'}`);

    if (validation.warnings.length > 0) {
      console.log('\n  Messages:');
      validation.warnings.forEach((warning) => {
        console.log(`    - ${warning}`);
      });
    }

    // Fail if configuration is invalid and security is required
    if (!validation.valid) {
      throw new Error(
        `[OpenAPI Adapter: ${this.options.name}] Invalid security configuration.\n` +
          `Missing auth provider mappings for security schemes: ${validation.missingMappings.join(', ')}\n\n` +
          `Your OpenAPI spec requires these security schemes, but no auth configuration was provided.\n\n` +
          `Add one of the following to your adapter configuration:\n\n` +
          `1. authProviderMapper (recommended):\n` +
          `   authProviderMapper: {\n` +
          validation.missingMappings.map((s) => `     '${s}': (authInfo) => authInfo.user?.${s.toLowerCase()}Token,`).join('\n') +
          `\n   }\n\n` +
          `2. securityResolver:\n` +
          `   securityResolver: (tool, authInfo) => ({ jwt: authInfo.token })\n\n` +
          `3. staticAuth:\n` +
          `   staticAuth: { jwt: process.env.API_TOKEN }\n\n` +
          `4. Include security in input (NOT recommended for production):\n` +
          `   generateOptions: { includeSecurityInInput: true }`
      );
    }

    console.log(''); // Empty line for readability

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

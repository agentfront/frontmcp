import { Adapter, DynamicAdapter, FrontMcpAdapterResponse, FrontMcpLogger } from '@frontmcp/sdk';
import { OpenApiAdapterOptions, InputTransform, ToolTransform, ExtendedMcpOpenAPITool } from './openapi.types';
import { OpenAPIToolGenerator, McpOpenAPITool } from 'mcp-from-openapi';
import { createOpenApiTool } from './openapi.tool';
import { validateSecurityConfiguration } from './openapi.security';

/** Reserved keys that cannot be used as inputKey (prototype pollution protection) */
const RESERVED_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Creates a simple console-based logger for use outside the SDK context.
 */
function createConsoleLogger(prefix: string): FrontMcpLogger {
  const formatMessage = (level: string, msg: string) => `[${prefix}] ${level}: ${msg}`;
  return {
    verbose: (msg: string, ...args: unknown[]) => console.debug(formatMessage('VERBOSE', msg), ...args),
    debug: (msg: string, ...args: unknown[]) => console.debug(formatMessage('DEBUG', msg), ...args),
    info: (msg: string, ...args: unknown[]) => console.info(formatMessage('INFO', msg), ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(formatMessage('WARN', msg), ...args),
    error: (msg: string, ...args: unknown[]) => console.error(formatMessage('ERROR', msg), ...args),
    child: (childPrefix: string) => createConsoleLogger(`${prefix}:${childPrefix}`),
  };
}

@Adapter({
  name: 'openapi',
  description: 'OpenAPI adapter for FrontMCP - Automatically generates MCP tools from OpenAPI specifications',
})
export default class OpenapiAdapter extends DynamicAdapter<OpenApiAdapterOptions> {
  private generator?: OpenAPIToolGenerator;
  private logger: FrontMcpLogger;
  public options: OpenApiAdapterOptions;

  constructor(options: OpenApiAdapterOptions) {
    super();
    this.options = options;
    // Use provided logger or create console fallback
    this.logger = options.logger ?? createConsoleLogger(`openapi:${options.name}`);
  }

  /**
   * Receive the SDK logger. Called by the SDK before fetch().
   */
  setLogger(logger: FrontMcpLogger): void {
    this.logger = logger;
  }

  async fetch(): Promise<FrontMcpAdapterResponse> {
    // Lazy load: Initialize generator on first fetch if not already initialized
    if (!this.generator) {
      this.generator = await this.initializeGenerator();
    }

    // Determine if we need security in input
    // If securitySchemesInInput is set, we need all security in input first, then filter
    const hasPerSchemeControl = this.options.securitySchemesInInput && this.options.securitySchemesInInput.length > 0;
    const includeSecurityInInput =
      hasPerSchemeControl || (this.options.generateOptions?.includeSecurityInInput ?? false);

    // Generate tools from OpenAPI spec
    let openapiTools = await this.generator.generateTools({
      includeOperations: this.options.generateOptions?.includeOperations,
      excludeOperations: this.options.generateOptions?.excludeOperations,
      filterFn: this.options.generateOptions?.filterFn,
      namingStrategy: this.options.generateOptions?.namingStrategy,
      preferredStatusCodes: this.options.generateOptions?.preferredStatusCodes ?? [200, 201, 202, 204],
      includeDeprecated: this.options.generateOptions?.includeDeprecated ?? false,
      includeAllResponses: this.options.generateOptions?.includeAllResponses ?? true,
      includeSecurityInInput: includeSecurityInInput,
      maxSchemaDepth: this.options.generateOptions?.maxSchemaDepth,
      includeExamples: this.options.generateOptions?.includeExamples,
    });

    // If per-scheme control is enabled, filter security inputs
    if (hasPerSchemeControl) {
      openapiTools = openapiTools.map((tool) => this.filterSecuritySchemes(tool));
    }

    // Validate security configuration
    const validation = validateSecurityConfiguration(openapiTools, this.options);

    // Log security information
    this.logger.info('Security Analysis:');
    this.logger.info(`  Security Risk Score: ${validation.securityRiskScore.toUpperCase()}`);
    this.logger.info(`  Valid Configuration: ${validation.valid ? 'YES' : 'NO'}`);

    if (validation.warnings.length > 0) {
      this.logger.info('Messages:');
      validation.warnings.forEach((warning) => {
        if (warning.startsWith('ERROR:')) {
          this.logger.error(`  - ${warning}`);
        } else if (warning.startsWith('SECURITY WARNING:')) {
          this.logger.warn(`  - ${warning}`);
        } else {
          this.logger.info(`  - ${warning}`);
        }
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
          validation.missingMappings
            .map((s) => `     '${s}': (authInfo) => authInfo.user?.${s.toLowerCase()}Token,`)
            .join('\n') +
          `\n   }\n\n` +
          `2. securityResolver:\n` +
          `   securityResolver: (tool, authInfo) => ({ jwt: authInfo.token })\n\n` +
          `3. staticAuth:\n` +
          `   staticAuth: { jwt: process.env.API_TOKEN }\n\n` +
          `4. Include security in input (NOT recommended for production):\n` +
          `   generateOptions: { includeSecurityInInput: true }`,
      );
    }

    // Apply all transforms to tools
    let transformedTools = openapiTools;

    // 1. Apply description mode (generates description from summary/description)
    if (this.options.descriptionMode && this.options.descriptionMode !== 'summaryOnly') {
      transformedTools = transformedTools.map((tool) => this.applyDescriptionMode(tool));
    }

    // 2. Apply tool transforms (annotations, name, description overrides, etc.)
    if (this.options.toolTransforms) {
      transformedTools = transformedTools.map((tool) => this.applyToolTransforms(tool));
    }

    // 3. Apply input transforms (hide inputs, inject values at runtime)
    if (this.options.inputTransforms) {
      transformedTools = transformedTools.map((tool) => this.applyInputTransforms(tool));
    }

    // Convert OpenAPI tools to FrontMCP tools
    const tools = transformedTools.map((openapiTool) => createOpenApiTool(openapiTool, this.options, this.logger));

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

  /**
   * Apply description mode to generate description from summary/description
   * @private
   */
  private applyDescriptionMode(tool: McpOpenAPITool): McpOpenAPITool {
    const mode = this.options.descriptionMode || 'summaryOnly';
    const metadata = tool.metadata as unknown as Record<string, unknown>;
    const summary = metadata['operationSummary'] as string | undefined;
    const opDescription = metadata['operationDescription'] as string | undefined;
    const operationId = metadata['operationId'] as string | undefined;
    const method = metadata['method'] as string;
    const path = metadata['path'] as string;

    let description: string;

    switch (mode) {
      case 'descriptionOnly':
        description = opDescription || summary || `${method.toUpperCase()} ${path}`;
        break;
      case 'combined':
        if (summary && opDescription) {
          description = `${summary}\n\n${opDescription}`;
        } else {
          description = summary || opDescription || `${method.toUpperCase()} ${path}`;
        }
        break;
      case 'full': {
        const parts: string[] = [];
        if (summary) parts.push(summary);
        if (opDescription && opDescription !== summary) parts.push(opDescription);
        if (operationId) parts.push(`Operation: ${operationId}`);
        parts.push(`${method.toUpperCase()} ${path}`);
        description = parts.join('\n\n');
        break;
      }
      default:
        // 'summaryOnly' - use existing description
        return tool;
    }

    return {
      ...tool,
      description,
    };
  }

  /**
   * Collect tool transforms for a specific tool
   * @private
   */
  private collectToolTransforms(tool: McpOpenAPITool): ToolTransform {
    const result: ToolTransform = {};
    const opts = this.options.toolTransforms;
    if (!opts) return result;

    // 1. Apply global transforms
    if (opts.global) {
      Object.assign(result, opts.global);
      if (opts.global.annotations) {
        result.annotations = { ...opts.global.annotations };
      }
      if (opts.global.tags) {
        result.tags = [...opts.global.tags];
      }
      if (opts.global.examples) {
        result.examples = [...opts.global.examples];
      }
    }

    // 2. Apply per-tool transforms (override global)
    if (opts.perTool?.[tool.name]) {
      const perTool = opts.perTool[tool.name];
      if (perTool.name) result.name = perTool.name;
      if (perTool.description) result.description = perTool.description;
      if (perTool.hideFromDiscovery !== undefined) result.hideFromDiscovery = perTool.hideFromDiscovery;
      if (perTool.ui) result.ui = perTool.ui;
      if (perTool.annotations) {
        result.annotations = { ...result.annotations, ...perTool.annotations };
      }
      if (perTool.tags) {
        result.tags = [...(result.tags || []), ...perTool.tags];
      }
      if (perTool.examples) {
        result.examples = [...(result.examples || []), ...perTool.examples];
      }
    }

    // 3. Apply generator-produced transforms (override per-tool)
    if (opts.generator) {
      const generated = opts.generator(tool);
      if (generated) {
        if (generated.name) result.name = generated.name;
        if (generated.description) result.description = generated.description;
        if (generated.hideFromDiscovery !== undefined) result.hideFromDiscovery = generated.hideFromDiscovery;
        if (generated.ui) result.ui = generated.ui;
        if (generated.annotations) {
          result.annotations = { ...result.annotations, ...generated.annotations };
        }
        if (generated.tags) {
          result.tags = [...(result.tags || []), ...generated.tags];
        }
        if (generated.examples) {
          result.examples = [...(result.examples || []), ...generated.examples];
        }
      }
    }

    return result;
  }

  /**
   * Apply tool transforms to an OpenAPI tool
   * @private
   */
  private applyToolTransforms(tool: McpOpenAPITool): McpOpenAPITool {
    const transforms = this.collectToolTransforms(tool);
    if (Object.keys(transforms).length === 0) return tool;

    let newName = tool.name;
    let newDescription = tool.description;

    // Apply name transform
    if (transforms.name) {
      newName = typeof transforms.name === 'function' ? transforms.name(tool.name, tool) : transforms.name;
    }

    // Apply description transform
    if (transforms.description) {
      newDescription =
        typeof transforms.description === 'function'
          ? transforms.description(tool.description, tool)
          : transforms.description;
    }

    this.logger.debug(`Applied tool transforms to '${tool.name}'`);

    const metadataRecord = tool.metadata as unknown as Record<string, unknown>;
    const existingAdapter = metadataRecord['adapter'] as Record<string, unknown> | undefined;
    return {
      ...tool,
      name: newName,
      description: newDescription,
      metadata: {
        ...tool.metadata,
        adapter: {
          ...(existingAdapter || {}),
          toolTransform: transforms,
        },
      },
    } as ExtendedMcpOpenAPITool;
  }

  /**
   * Collect all input transforms for a specific tool
   * @private
   */
  private collectTransformsForTool(tool: McpOpenAPITool): InputTransform[] {
    const transforms: InputTransform[] = [];
    const opts = this.options.inputTransforms;
    if (!opts) return transforms;

    // 1. Add global transforms
    if (opts.global) {
      transforms.push(...opts.global);
    }

    // 2. Add per-tool transforms
    if (opts.perTool?.[tool.name]) {
      transforms.push(...opts.perTool[tool.name]);
    }

    // 3. Add generator-produced transforms
    if (opts.generator) {
      transforms.push(...opts.generator(tool));
    }

    return transforms;
  }

  /**
   * Apply input transforms to an OpenAPI tool
   * - Removes transformed inputKeys from the inputSchema
   * - Stores transform metadata for runtime injection
   * @private
   */
  private applyInputTransforms(tool: McpOpenAPITool): McpOpenAPITool {
    const transforms = this.collectTransformsForTool(tool);
    if (transforms.length === 0) return tool;

    // Validate input keys against reserved keys (prototype pollution protection)
    for (const transform of transforms) {
      if (RESERVED_KEYS.includes(transform.inputKey)) {
        throw new Error(
          `Invalid inputKey '${transform.inputKey}' in tool '${tool.name}': ` +
            `reserved keys (${RESERVED_KEYS.join(', ')}) cannot be used`,
        );
      }
    }

    const transformedInputKeys = new Set(transforms.map((t) => t.inputKey));

    // Clone and modify inputSchema to remove transformed keys
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    const properties = (inputSchema?.['properties'] as Record<string, unknown>) || {};
    const required = (inputSchema?.['required'] as string[]) || [];

    // Remove transformed keys from properties
    const newProperties = { ...properties };
    for (const key of transformedInputKeys) {
      delete newProperties[key];
    }

    // Update required array to exclude transformed keys
    const newRequired = required.filter((key) => !transformedInputKeys.has(key));

    this.logger.debug(`Applied ${transforms.length} input transforms to tool '${tool.name}'`);

    const metadataRecord = tool.metadata as unknown as Record<string, unknown>;
    const existingAdapter = metadataRecord['adapter'] as Record<string, unknown> | undefined;
    return {
      ...tool,
      inputSchema: {
        ...inputSchema,
        properties: newProperties,
        ...(newRequired.length > 0 ? { required: newRequired } : {}),
      },
      // Store transforms in metadata for runtime use
      metadata: {
        ...tool.metadata,
        adapter: {
          ...(existingAdapter || {}),
          inputTransforms: transforms,
        },
      },
    } as ExtendedMcpOpenAPITool;
  }

  /**
   * Filter security schemes in tool input based on securitySchemesInInput option.
   * Removes security inputs that should be resolved from context instead of user input.
   * @private
   */
  private filterSecuritySchemes(tool: McpOpenAPITool): McpOpenAPITool {
    const allowedSchemes = new Set(this.options.securitySchemesInInput || []);
    if (allowedSchemes.size === 0) return tool;

    // Find security mappers that should NOT be in input (resolved from context)
    const schemesToRemove = new Set<string>();
    const inputKeysToRemove = new Set<string>();

    for (const mapper of tool.mapper) {
      if (mapper.security?.scheme && !allowedSchemes.has(mapper.security.scheme)) {
        schemesToRemove.add(mapper.security.scheme);
        inputKeysToRemove.add(mapper.inputKey);
      }
    }

    if (inputKeysToRemove.size === 0) return tool;

    // Remove security inputs from inputSchema
    const inputSchema = tool.inputSchema as Record<string, unknown>;
    const properties = (inputSchema?.['properties'] as Record<string, unknown>) || {};
    const required = (inputSchema?.['required'] as string[]) || [];

    const newProperties = { ...properties };
    for (const key of inputKeysToRemove) {
      delete newProperties[key];
    }

    const newRequired = required.filter((key) => !inputKeysToRemove.has(key));

    this.logger.debug(
      `[${tool.name}] Filtered security schemes from input: ${Array.from(schemesToRemove).join(', ')}. ` +
        `Kept in input: ${
          Array.from(allowedSchemes)
            .filter((s) => !schemesToRemove.has(s))
            .join(', ') || 'none'
        }`,
    );

    const metadataRecord = tool.metadata as unknown as Record<string, unknown>;
    const existingAdapter = metadataRecord['adapter'] as Record<string, unknown> | undefined;
    return {
      ...tool,
      inputSchema: {
        ...inputSchema,
        properties: newProperties,
        ...(newRequired.length > 0 ? { required: newRequired } : {}),
      },
      // Store which security schemes are in input vs context for later resolution
      metadata: {
        ...tool.metadata,
        adapter: {
          ...(existingAdapter || {}),
          securitySchemesInInput: Array.from(allowedSchemes),
          securitySchemesFromContext: Array.from(schemesToRemove),
        },
      },
    } as ExtendedMcpOpenAPITool;
  }
}

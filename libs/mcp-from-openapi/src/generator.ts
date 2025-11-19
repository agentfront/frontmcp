import * as yaml from 'yaml';
import * as fs from 'fs/promises';
import * as path from 'path';
import $RefParser from '@apidevtools/json-schema-ref-parser';
import type {
  OpenAPIDocument,
  LoadOptions,
  GenerateOptions,
  McpOpenAPITool,
  ValidationResult,
  HTTPMethod,
  ParameterObject,
} from './types';
import { isReferenceObject } from './types';
import { ParameterResolver } from './parameter-resolver';
import { ResponseBuilder } from './response-builder';
import { Validator } from './validator';
import { LoadError, ParseError } from './errors';

/**
 * Main class for generating MCP tools from OpenAPI specifications
 */
export class OpenAPIToolGenerator {
  private document: OpenAPIDocument;
  private dereferencedDocument?: OpenAPIDocument;
  private options: Required<LoadOptions>;

  /**
   * Private constructor - use static factory methods to create instances
   */
  private constructor(document: OpenAPIDocument, options: LoadOptions = {}) {
    this.document = document;
    this.options = {
      dereference: options.dereference ?? true,
      baseUrl: options.baseUrl ?? '',
      headers: options.headers ?? {},
      timeout: options.timeout ?? 30000,
      validate: options.validate ?? true,
      followRedirects: options.followRedirects ?? true,
    };
  }

  /**
   * Create generator from a URL
   */
  static async fromURL(url: string, options: LoadOptions = {}): Promise<OpenAPIToolGenerator> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeout ?? 30000);

      const response = await fetch(url, {
        headers: options.headers,
        signal: controller.signal,
        redirect: options.followRedirects ?? true ? 'follow' : 'manual',
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new LoadError(`Failed to fetch OpenAPI spec from URL: ${response.status} ${response.statusText}`, {
          url,
          status: response.status,
        });
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();

      let document: OpenAPIDocument;
      if (contentType.includes('yaml') || contentType.includes('yml') || url.match(/\.ya?ml$/i)) {
        document = yaml.parse(text);
      } else {
        document = JSON.parse(text);
      }

      return new OpenAPIToolGenerator(document, options);
    } catch (error: unknown) {
      if (error instanceof LoadError) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new LoadError(`Failed to load OpenAPI spec from URL: ${errorMessage}`, {
        url,
        originalError: error,
      });
    }
  }

  /**
   * Create generator from a file path
   */
  static async fromFile(filePath: string, options: LoadOptions = {}): Promise<OpenAPIToolGenerator> {
    try {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      const content = await fs.readFile(absolutePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();

      let document: OpenAPIDocument;
      if (ext === '.yaml' || ext === '.yml') {
        document = yaml.parse(content);
      } else if (ext === '.json') {
        document = JSON.parse(content);
      } else {
        // Try to parse as JSON first, then YAML
        try {
          document = JSON.parse(content);
        } catch {
          document = yaml.parse(content);
        }
      }

      return new OpenAPIToolGenerator(document, options);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new LoadError(`Failed to load OpenAPI spec from file: ${errorMessage}`, {
        filePath,
        originalError: error,
      });
    }
  }

  /**
   * Create generator from a YAML string
   */
  static async fromYAML(yamlString: string, options: LoadOptions = {}): Promise<OpenAPIToolGenerator> {
    try {
      const document = yaml.parse(yamlString);
      return new OpenAPIToolGenerator(document, options);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new ParseError(`Failed to parse YAML: ${errorMessage}`, {
        originalError: error,
      });
    }
  }

  /**
   * Create generator from a JSON object
   */
  static async fromJSON(json: object, options: LoadOptions = {}): Promise<OpenAPIToolGenerator> {
    // Clone to avoid mutations
    const document = JSON.parse(JSON.stringify(json));
    return new OpenAPIToolGenerator(document, options);
  }

  /**
   * Get the OpenAPI document
   */
  getDocument(): OpenAPIDocument {
    return this.dereferencedDocument ?? this.document;
  }

  /**
   * Validate the OpenAPI document
   */
  async validate(): Promise<ValidationResult> {
    const validator = new Validator();
    return validator.validate(this.document);
  }

  /**
   * Initialize the generator (dereference if needed)
   */
  private async initialize(): Promise<void> {
    if (this.options.validate) {
      const result = await this.validate();
      if (!result.valid) {
        throw new ParseError('Invalid OpenAPI document', { errors: result.errors });
      }
    }

    if (this.options.dereference && !this.dereferencedDocument) {
      try {
        this.dereferencedDocument = (await $RefParser.dereference(
          JSON.parse(JSON.stringify(this.document)),
        )) as OpenAPIDocument;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new ParseError(`Failed to dereference OpenAPI document: ${errorMessage}`, {
          originalError: error,
        });
      }
    }
  }

  /**
   * Generate all tools from the OpenAPI specification
   */
  async generateTools(options: GenerateOptions = {}): Promise<McpOpenAPITool[]> {
    await this.initialize();

    const document = this.getDocument();
    const tools: McpOpenAPITool[] = [];

    if (!document.paths) {
      return tools;
    }

    for (const [pathStr, pathItem] of Object.entries(document.paths)) {
      if (!pathItem || '$ref' in pathItem) continue;

      const methods: HTTPMethod[] = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'];

      for (const method of methods) {
        const operation = pathItem[method];
        if (!operation) continue;

        // Apply filters
        if (!this.shouldIncludeOperation(operation, pathStr, method, options)) {
          continue;
        }

        try {
          const tool = await this.generateTool(pathStr, method, options);
          tools.push(tool);
        } catch (error: any) {
          console.warn(`Failed to generate tool for ${method.toUpperCase()} ${pathStr}:`, error.message);
        }
      }
    }

    return tools;
  }

  /**
   * Generate a specific tool for a path and method
   */
  async generateTool(pathStr: string, method: string, options: GenerateOptions = {}): Promise<McpOpenAPITool> {
    await this.initialize();

    const document = this.getDocument();

    if (!document.paths) {
      throw new Error('No paths defined in OpenAPI document');
    }

    const pathItem = document.paths[pathStr];
    const operation = pathItem?.[method.toLowerCase() as HTTPMethod];

    if (!operation) {
      throw new Error(`Operation not found: ${method.toUpperCase()} ${pathStr}`);
    }

    // Resolve parameters
    const parameterResolver = new ParameterResolver(options.namingStrategy);

    // Filter out ReferenceObjects from parameters
    let pathParameters: ParameterObject[] | undefined = undefined;
    if (pathItem.parameters) {
      pathParameters = pathItem.parameters.filter(
        (p): p is ParameterObject => !isReferenceObject(p),
      ) as ParameterObject[];
    }

    const { inputSchema, mapper } = parameterResolver.resolve(operation, pathParameters);

    // Build response schema
    const responseBuilder = new ResponseBuilder(options);
    const outputSchema = responseBuilder.build(operation.responses);

    // Generate tool name
    const name = this.generateToolName(pathStr, method as HTTPMethod, operation.operationId, options);

    // Generate description
    const description = operation.summary || operation.description || `${method.toUpperCase()} ${pathStr}`;

    // Extract metadata
    const metadata = this.extractMetadata(pathStr, method as HTTPMethod, operation, document, outputSchema);

    return {
      name,
      description,
      inputSchema,
      outputSchema,
      mapper,
      metadata,
    };
  }

  /**
   * Check if an operation should be included
   */
  private shouldIncludeOperation(operation: any, path: string, method: string, options: GenerateOptions): boolean {
    // Check deprecated
    if (operation.deprecated && !options.includeDeprecated) {
      return false;
    }

    // Check operation ID filters
    if (options.includeOperations && operation.operationId) {
      if (!options.includeOperations.includes(operation.operationId)) {
        return false;
      }
    }

    if (options.excludeOperations && operation.operationId) {
      if (options.excludeOperations.includes(operation.operationId)) {
        return false;
      }
    }

    // Custom filter
    if (options.filterFn) {
      return options.filterFn({
        ...operation,
        path,
        method,
      } as any);
    }

    return true;
  }

  /**
   * Generate a tool name
   */
  private generateToolName(
    path: string,
    method: HTTPMethod,
    operationId?: string,
    options: GenerateOptions = {},
  ): string {
    if (options.namingStrategy?.toolNameGenerator) {
      return options.namingStrategy.toolNameGenerator(path, method, operationId);
    }

    if (operationId) {
      return operationId;
    }

    // Generate from path and method
    const sanitized = path
      .replace(/\{([^}]+)\}/g, 'By_$1')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    return `${method}_${sanitized}`;
  }

  /**
   * Extract metadata from operation
   */
  private extractMetadata(
    path: string,
    method: HTTPMethod,
    operation: any,
    document: OpenAPIDocument,
    outputSchema?: any,
  ): any {
    const metadata: any = {
      path,
      method,
      operationId: operation.operationId,
      tags: operation.tags,
      deprecated: operation.deprecated,
    };

    // Extract security requirements
    if (operation.security || document.security) {
      metadata.security = this.extractSecurityRequirements(operation.security ?? document.security, document);
    }

    // Extract servers
    if (operation.servers || document.servers) {
      metadata.servers = (operation.servers ?? document.servers).map((server: any) => ({
        url: this.options.baseUrl || server.url,
        description: server.description,
        variables: server.variables,
      }));
    } else if (this.options.baseUrl) {
      metadata.servers = [{ url: this.options.baseUrl }];
    }

    // Extract response status codes
    if (outputSchema && outputSchema.oneOf) {
      metadata.responseStatusCodes = outputSchema.oneOf.map((schema: any) => schema['x-status-code']).filter(Boolean);
    } else if (outputSchema?.['x-status-code']) {
      metadata.responseStatusCodes = [outputSchema['x-status-code']];
    }

    // External docs
    if (operation.externalDocs) {
      metadata.externalDocs = operation.externalDocs;
    }

    return metadata;
  }

  /**
   * Extract security requirements
   */
  private extractSecurityRequirements(security: Record<string, string[]>[], document: OpenAPIDocument): any[] {
    if (!security || !document.components?.securitySchemes) {
      return [];
    }

    return security.flatMap((req) =>
      Object.entries(req).map(([scheme, scopes]) => {
        const securityScheme = document.components!.securitySchemes![scheme];

        // Skip if it's a reference object
        if (isReferenceObject(securityScheme)) {
          return { scheme, type: 'unknown' as any, scopes };
        }

        return {
          scheme,
          type: securityScheme.type,
          scopes,
          name: 'name' in securityScheme ? securityScheme.name : undefined,
          in: 'in' in securityScheme ? securityScheme.in : undefined,
        };
      }),
    );
  }
}

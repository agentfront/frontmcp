import type { JSONSchema } from 'zod/v4/core';

/** JSON Schema type from Zod v4 */
type JsonSchema = JSONSchema.JSONSchema;
import type {
  ParameterMapper,
  ParameterObject,
  RequestBodyObject,
  NamingStrategy,
  ParameterLocation,
  SchemaObject,
  ReferenceObject,
  SecurityRequirement,
  SecurityParameterInfo,
  SecuritySchemeObject,
} from './types';
import { toJsonSchema, isReferenceObject } from './types';

/**
 * Resolves parameters and handles naming conflicts
 */
export class ParameterResolver {
  private namingStrategy: NamingStrategy;

  constructor(namingStrategy?: NamingStrategy) {
    this.namingStrategy = namingStrategy ?? {
      conflictResolver: this.defaultConflictResolver,
    };
  }

  /**
   * Default conflict resolver: prefix with location
   */
  private defaultConflictResolver(paramName: string, location: ParameterLocation, index: number): string {
    const locationPrefix = {
      path: 'path',
      query: 'query',
      header: 'header',
      cookie: 'cookie',
      body: 'body',
    }[location];

    return `${locationPrefix}${paramName.charAt(0).toUpperCase()}${paramName.slice(1)}`;
  }

  /**
   * Resolve all parameters for an operation
   */
  resolve(
    operation: any,
    pathParameters?: ParameterObject[],
    securityRequirements?: SecurityRequirement[],
    includeSecurityInInput?: boolean,
  ): {
    inputSchema: JsonSchema;
    mapper: ParameterMapper[];
  } {
    const allParameters: ParameterObject[] = [...(pathParameters ?? []), ...(operation.parameters ?? [])];

    const requestBody = operation.requestBody as RequestBodyObject | undefined;

    // Collect all parameter names and detect conflicts
    const parametersByName = new Map<string, ParameterInfo[]>();

    // Process standard parameters
    allParameters.forEach((param) => {
      const info: ParameterInfo = {
        name: param.name,
        location: param.in as ParameterLocation,
        required: param.required ?? param.in === 'path',
        schema: param.schema ?? { type: 'string' },
        description: param.description,
        style: param.style,
        explode: param.explode,
        allowReserved: param.allowReserved,
        deprecated: param.deprecated,
      };

      if (!parametersByName.has(param.name)) {
        parametersByName.set(param.name, []);
      }
      parametersByName.get(param.name)!.push(info);
    });

    // Process request body
    if (requestBody?.content) {
      const contentType = this.selectContentType(requestBody.content);
      const mediaType = requestBody.content[contentType];

      if (mediaType?.schema) {
        this.extractBodyParameters(mediaType.schema, parametersByName, requestBody.required ?? false, contentType);
      }
    }

    // Resolve conflicts and build schema + mapper
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    const mapper: ParameterMapper[] = [];

    for (const [originalName, params] of parametersByName.entries()) {
      if (params.length === 1) {
        // No conflict
        const param = params[0];
        const inputKey = originalName;

        properties[inputKey] = this.buildParameterSchema(param);
        if (param.required) {
          required.push(inputKey);
        }

        mapper.push({
          inputKey,
          type: param.location,
          key: originalName,
          required: param.required,
          style: param.style,
          explode: param.explode,
          serialization: param.serialization,
        });
      } else {
        // Conflict - need to resolve
        params.forEach((param, index) => {
          const inputKey = this.namingStrategy.conflictResolver(originalName, param.location, index);

          properties[inputKey] = this.buildParameterSchema(param);
          if (param.required) {
            required.push(inputKey);
          }

          mapper.push({
            inputKey,
            type: param.location,
            key: originalName,
            required: param.required,
            style: param.style,
            explode: param.explode,
            serialization: param.serialization,
          });
        });
      }
    }

    // Process security requirements
    if (securityRequirements && securityRequirements.length > 0) {
      this.processSecurityRequirements(
        securityRequirements,
        properties,
        required,
        mapper,
        includeSecurityInInput ?? false,
      );
    }

    const inputSchema: JsonSchema = {
      type: 'object',
      properties,
      ...(required.length > 0 && { required }),
      additionalProperties: false,
    };

    return { inputSchema, mapper };
  }

  /**
   * Extract parameters from request body schema
   */
  private extractBodyParameters(
    schema: SchemaObject | ReferenceObject,
    parametersByName: Map<string, ParameterInfo[]>,
    required: boolean,
    contentType: string,
    prefix = '',
  ): void {
    if (!schema || typeof schema !== 'object') return;

    // Convert to JsonSchema for processing
    const jsonSchema = toJsonSchema(schema);

    // Handle object schemas
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const requiredFields = new Set(jsonSchema.required ?? []);

      for (const [propName, propSchema] of Object.entries(jsonSchema.properties)) {
        const fullName = prefix ? `${prefix}.${propName}` : propName;
        const isRequired = required && requiredFields.has(propName);

        if (typeof propSchema === 'object') {
          const info: ParameterInfo = {
            name: fullName,
            location: 'body',
            required: isRequired,
            schema: propSchema as JsonSchema,
            description: (propSchema as any).description,
            serialization: {
              contentType,
            },
          };

          if (!parametersByName.has(fullName)) {
            parametersByName.set(fullName, []);
          }
          parametersByName.get(fullName)!.push(info);
        }
      }
    } else {
      // For non-object bodies (arrays, primitives), treat as single parameter
      const bodyParamName = prefix || 'body';
      const info: ParameterInfo = {
        name: bodyParamName,
        location: 'body',
        required,
        schema,
        serialization: {
          contentType,
        },
      };

      if (!parametersByName.has(bodyParamName)) {
        parametersByName.set(bodyParamName, []);
      }
      parametersByName.get(bodyParamName)!.push(info);
    }
  }

  /**
   * Build JSON Schema for a parameter
   */
  private buildParameterSchema(param: ParameterInfo): JsonSchema {
    const schema: JsonSchema = toJsonSchema(param.schema as any);

    if (param.description) {
      schema.description = param.description;
    }

    if (param.deprecated) {
      schema['deprecated'] = true;
    }

    // Add parameter metadata
    (schema as any)['x-parameter-location'] = param.location;
    if (param.style) {
      (schema as any)['x-parameter-style'] = param.style;
    }
    if (param.explode !== undefined) {
      (schema as any)['x-parameter-explode'] = param.explode;
    }

    return schema;
  }

  /**
   * Select the most appropriate content type
   */
  private selectContentType(content: Record<string, any>): string {
    // Preference order
    const preferences = [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'application/xml',
      'text/plain',
    ];

    for (const pref of preferences) {
      if (content[pref]) return pref;
    }

    // Fallback to first available
    const firstKey = Object.keys(content)[0];
    if (!firstKey) {
      throw new Error('No content type available in request body');
    }
    return firstKey;
  }

  /**
   * Process security requirements and add to mapper/inputSchema
   */
  private processSecurityRequirements(
    securityRequirements: SecurityRequirement[],
    properties: Record<string, JsonSchema>,
    required: string[],
    mapper: ParameterMapper[],
    includeInInput: boolean,
  ): void {
    for (const secReq of securityRequirements) {
      const { scheme, type, name: apiKeyName, in: apiKeyIn, scopes } = secReq;

      // Build security parameter info
      const securityInfo: SecurityParameterInfo = {
        scheme,
        type,
        scopes,
      };

      // Determine parameter details based on security type
      let inputKey: string;
      let headerKey: string;
      let paramLocation: ParameterLocation;
      let description: string;
      let schema: JsonSchema;

      if (type === 'http') {
        // HTTP auth (bearer, basic, etc.)
        inputKey = scheme;
        headerKey = 'Authorization';
        paramLocation = 'header';

        const httpScheme = 'httpScheme' in secReq && secReq.httpScheme ? secReq.httpScheme : 'bearer';
        const bearerFormat = 'bearerFormat' in secReq ? secReq.bearerFormat : undefined;

        securityInfo.httpScheme = httpScheme;
        if (bearerFormat) {
          securityInfo.bearerFormat = bearerFormat;
        }

        description = `${httpScheme.charAt(0).toUpperCase()}${httpScheme.slice(1)} authentication token`;
        if (bearerFormat) {
          description += ` (${bearerFormat})`;
        }

        schema = {
          type: 'string',
          description,
        };
      } else if (type === 'apiKey') {
        // API Key auth
        inputKey = scheme;
        headerKey = apiKeyName || 'X-API-Key';
        paramLocation = (apiKeyIn || 'header') as ParameterLocation;

        securityInfo.apiKeyName = apiKeyName;
        securityInfo.apiKeyIn = apiKeyIn;

        description = `API key for ${scheme}`;
        schema = {
          type: 'string',
          description,
        };
      } else if (type === 'oauth2' || type === 'openIdConnect') {
        // OAuth2 / OpenID Connect
        inputKey = scheme;
        headerKey = 'Authorization';
        paramLocation = 'header';

        description = `OAuth2 access token${scopes && scopes.length > 0 ? ` (scopes: ${scopes.join(', ')})` : ''}`;
        schema = {
          type: 'string',
          description,
        };
      } else {
        // Unknown type, skip
        continue;
      }

      // Add to mapper (always)
      mapper.push({
        inputKey,
        type: paramLocation,
        key: headerKey,
        required: true,
        security: securityInfo,
      });

      // Add to inputSchema (only if includeInInput is true)
      if (includeInInput) {
        properties[inputKey] = schema;
        required.push(inputKey);
      }
    }
  }
}

/**
 * Internal parameter info structure
 */
interface ParameterInfo {
  name: string;
  location: ParameterLocation;
  required: boolean;
  schema: SchemaObject | ReferenceObject | JsonSchema;
  description?: string;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
  deprecated?: boolean;
  serialization?: {
    contentType?: string;
    encoding?: Record<string, any>;
  };
}

import type { JSONSchema7 } from 'json-schema';
import type {
  ParameterMapper,
  ParameterObject,
  RequestBodyObject,
  NamingStrategy,
  ParameterLocation,
  SchemaObject,
  ReferenceObject,
} from './types';
import { toJSONSchema7 } from './types';

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
  private defaultConflictResolver(
    paramName: string,
    location: ParameterLocation,
    index: number
  ): string {
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
    pathParameters?: ParameterObject[]
  ): {
    inputSchema: JSONSchema7;
    mapper: ParameterMapper[];
  } {
    const allParameters: ParameterObject[] = [
      ...(pathParameters ?? []),
      ...(operation.parameters ?? []),
    ];

    const requestBody = operation.requestBody as RequestBodyObject | undefined;

    // Collect all parameter names and detect conflicts
    const parametersByName = new Map<string, ParameterInfo[]>();

    // Process standard parameters
    allParameters.forEach((param) => {
      const info: ParameterInfo = {
        name: param.name,
        location: param.in as ParameterLocation,
        required: param.required ?? (param.in === 'path'),
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
        this.extractBodyParameters(
          mediaType.schema,
          parametersByName,
          requestBody.required ?? false,
          contentType
        );
      }
    }

    // Resolve conflicts and build schema + mapper
    const properties: Record<string, JSONSchema7> = {};
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
          const inputKey = this.namingStrategy.conflictResolver(
            originalName,
            param.location,
            index
          );

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

    const inputSchema: JSONSchema7 = {
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
    prefix = ''
  ): void {
    if (!schema || typeof schema !== 'object') return;

    // Convert to JSONSchema7 for processing
    const jsonSchema = toJSONSchema7(schema);

    // Handle object schemas
    if (jsonSchema.type === 'object' && jsonSchema.properties) {
      const requiredFields = new Set(jsonSchema.required ?? []);

      for (const [propName, propSchema] of Object.entries(jsonSchema.properties)) {
        const fullName = prefix ? `${prefix}.${propName}` : propName;
        const isRequired = required && requiredFields.has(propName);

        if (typeof propSchema === 'object' && !('$ref' in propSchema)) {
          const info: ParameterInfo = {
            name: fullName,
            location: 'body',
            required: isRequired,
            schema: propSchema as JSONSchema7,
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
  private buildParameterSchema(param: ParameterInfo): JSONSchema7 {
    const schema: JSONSchema7 = toJSONSchema7(param.schema as any);

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
}

/**
 * Internal parameter info structure
 */
interface ParameterInfo {
  name: string;
  location: ParameterLocation;
  required: boolean;
  schema: SchemaObject | ReferenceObject | JSONSchema7;
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

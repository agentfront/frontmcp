// Main exports
export { OpenAPIToolGenerator } from './generator';
export { SchemaBuilder } from './schema-builder';
export { ParameterResolver } from './parameter-resolver';
export { ResponseBuilder } from './response-builder';
export { Validator } from './validator';

// Error exports
export {
  OpenAPIToolError,
  LoadError,
  ParseError,
  ValidationError,
  GenerationError,
  SchemaError,
} from './errors';

// Type exports
export type {
  // Main MCP types
  McpOpenAPITool,
  ParameterMapper,
  ToolMetadata,
  SerializationInfo,
  SecurityRequirement,
  ServerInfo,

  // Configuration types
  LoadOptions,
  GenerateOptions,
  NamingStrategy,
  OperationWithContext,

  // Basic types
  OpenAPIDocument,
  OpenAPIVersion,
  HTTPMethod,
  ParameterLocation,
  AuthType,

  // Re-exported OpenAPI types (from openapi-types package)
  OperationObject,
  ParameterObject,
  RequestBodyObject,
  ResponseObject,
  ResponsesObject,
  MediaTypeObject,
  HeaderObject,
  ExampleObject,
  PathItemObject,
  PathsObject,
  ServerObject,
  SecuritySchemeObject,
  ReferenceObject,
  TagObject,
  ExternalDocumentationObject,
  ServerVariableObject,
  EncodingObject,
  SecurityRequirementObject,
  SchemaObject,

  // Validation types
  ValidationResult,
  ValidationErrorDetail,
  ValidationWarning,
} from './types';

// Utility exports
export { isReferenceObject, toJSONSchema7 } from './types';

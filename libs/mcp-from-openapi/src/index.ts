// Main exports
export { OpenAPIToolGenerator } from './generator';
export { SchemaBuilder } from './schema-builder';
export { ParameterResolver } from './parameter-resolver';
export { ResponseBuilder } from './response-builder';
export { Validator } from './validator';
export { SecurityResolver, createSecurityContext } from './security-resolver';

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
  SecurityParameterInfo,
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

// Security resolver types
export type {
  SecurityContext,
  ResolvedSecurity,
  DigestAuthCredentials,
  ClientCertificate,
  AWSCredentials,
  SignatureData,
} from './security-resolver';

// Utility exports
export { isReferenceObject, toJSONSchema7 } from './types';

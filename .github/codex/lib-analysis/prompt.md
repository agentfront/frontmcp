Analyze the following independent libraries and determine:

1. The appropriate semantic version bump (MAJOR/MINOR/PATCH)
2. A changelog entry for each library

Today's date: 2025-12-11

Semantic Versioning Rules:

- MAJOR: Breaking changes, incompatible API changes
- MINOR: New features, backwards-compatible functionality additions
- PATCH: Backwards-compatible bug fixes, documentation, refactoring, minor improvements

Libraries to analyze:

================================================================================
LIBRARY: json-schema-to-zod-v3
CURRENT VERSION: 1.0.0
================================================================================

COMMITS:
05c6414 feat(security): Enhance AgentScript runtime property protection (#86)
a8f3ac2 feat(auth): enhance authorization module with new utilities and session management (#77)
e41227a feat(plugins): new CodeCall plugin (WIP) (#53)

DIFF (truncated to 8000 chars):
diff --git a/libs/json-schema-to-zod-v3/.spec.swcrc b/libs/json-schema-to-zod-v3/.spec.swcrc
index 3b52a53..5866105 100644
--- a/libs/json-schema-to-zod-v3/.spec.swcrc
+++ b/libs/json-schema-to-zod-v3/.spec.swcrc
@@ -1,6 +1,6 @@
{
"jsc": {

- "target": "es2017",

* "target": "es2022",
  "parser": {
  "syntax": "typescript",
  "decorators": true,
  diff --git a/libs/json-schema-to-zod-v3/jest.config.ts b/libs/json-schema-to-zod-v3/jest.config.ts
  index 914a303..518cc2f 100644
  --- a/libs/json-schema-to-zod-v3/jest.config.ts
  +++ b/libs/json-schema-to-zod-v3/jest.config.ts
  @@ -1,19 +1,33 @@
  -import { readFileSync } from 'fs';

- -// Reading the SWC compilation config for the spec files
  -const swcJestConfig = JSON.parse(
- readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
  -);
- -// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
  -swcJestConfig.swcrc = false;
- export default {
  displayName: 'json-schema-to-zod-v3',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
- '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],

* '^.+\\.[tj]s$': [
*      '@swc/jest',
*      {
*        jsc: {
*          target: 'es2022',
*          parser: {
*            syntax: 'typescript',
*            decorators: true,
*            dynamicImport: true,
*          },
*          transform: {
*            decoratorMetadata: true,
*            legacyDecorator: true,
*          },
*          keepClassNames: true,
*          externalHelpers: true,
*          loose: true,
*        },
*        module: {
*          type: 'es6',
*        },
*        sourceMaps: true,
*        swcrc: false,
*      },
* ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  diff --git a/libs/json-schema-to-zod-v3/package.json b/libs/json-schema-to-zod-v3/package.json
  index d558566..b86358f 100644
  --- a/libs/json-schema-to-zod-v3/package.json
  +++ b/libs/json-schema-to-zod-v3/package.json
  @@ -21,7 +21,8 @@
  ],
  "repository": {
  "type": "git",

- "url": "git+https://github.com/agentfront/frontmcp.git"

* "url": "git+https://github.com/agentfront/frontmcp.git",
* "directory": "libs/json-schema-to-zod-v3"
  },
  "bugs": {
  "url": "https://github.com/agentfront/frontmcp/issues"
  @@ -42,7 +43,7 @@
  "zod": "^3.0.0"
  },
  "devDependencies": {

- "@types/node": "^22.0.0",

* "@types/node": "^24.0.0",
  "typescript": "^5.0.0",
  "zod": "^3.23.8"
  }
  diff --git a/libs/json-schema-to-zod-v3/tsconfig.lib.json b/libs/json-schema-to-zod-v3/tsconfig.lib.json
  index 33eca2c..566be4d 100644
  --- a/libs/json-schema-to-zod-v3/tsconfig.lib.json
  +++ b/libs/json-schema-to-zod-v3/tsconfig.lib.json
  @@ -6,5 +6,11 @@
  "types": ["node"]
  },
  "include": ["src/**/*.ts"],

- "exclude": ["jest.config.ts", "src/**/*.spec.ts", "src/**/*.test.ts"]

* "exclude": [
* "jest.config.ts",
* "src/\*_/_.spec.ts",
* "src/\*_/_.test.ts",
* "src/**/**tests**/**",
* "src/**/**test-utils**/**"
* ]
  }

================================================================================
LIBRARY: mcp-from-openapi
CURRENT VERSION: 1.0.0
================================================================================

COMMITS:
b44c2d4 feat(deps): Upgrade to @modelcontextprotocol/sdk version 1.23 and Zod to v4 (#90)
05c6414 feat(security): Enhance AgentScript runtime property protection (#86)
a8f3ac2 feat(auth): enhance authorization module with new utilities and session management (#77)
e41227a feat(plugins): new CodeCall plugin (WIP) (#53)

DIFF (truncated to 8000 chars):
diff --git a/libs/mcp-from-openapi/.spec.swcrc b/libs/mcp-from-openapi/.spec.swcrc
index 3b52a53..5866105 100644
--- a/libs/mcp-from-openapi/.spec.swcrc
+++ b/libs/mcp-from-openapi/.spec.swcrc
@@ -1,6 +1,6 @@
{
"jsc": {

- "target": "es2017",

* "target": "es2022",
  "parser": {
  "syntax": "typescript",
  "decorators": true,
  diff --git a/libs/mcp-from-openapi/jest.config.ts b/libs/mcp-from-openapi/jest.config.ts
  index 57c0b2e..4a25025 100644
  --- a/libs/mcp-from-openapi/jest.config.ts
  +++ b/libs/mcp-from-openapi/jest.config.ts
  @@ -1,19 +1,33 @@
  -import { readFileSync } from 'fs';

- -// Reading the SWC compilation config for the spec files
  -const swcJestConfig = JSON.parse(
- readFileSync(`${__dirname}/.spec.swcrc`, 'utf-8')
  -);
- -// Disable .swcrc look-up by SWC core because we're passing in swcJestConfig ourselves
  -swcJestConfig.swcrc = false;
- export default {
  displayName: 'mcp-from-openapi',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
- '^.+\\.[tj]s$': ['@swc/jest', swcJestConfig],

* '^.+\\.[tj]s$': [
*      '@swc/jest',
*      {
*        jsc: {
*          target: 'es2022',
*          parser: {
*            syntax: 'typescript',
*            decorators: true,
*            dynamicImport: true,
*          },
*          transform: {
*            decoratorMetadata: true,
*            legacyDecorator: true,
*          },
*          keepClassNames: true,
*          externalHelpers: true,
*          loose: true,
*        },
*        module: {
*          type: 'es6',
*        },
*        sourceMaps: true,
*        swcrc: false,
*      },
* ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: 'test-output/jest/coverage',
  diff --git a/libs/mcp-from-openapi/package.json b/libs/mcp-from-openapi/package.json
  index 88c69fa..1e5d2ef 100644
  --- a/libs/mcp-from-openapi/package.json
  +++ b/libs/mcp-from-openapi/package.json
  @@ -20,7 +20,8 @@
  ],
  "repository": {
  "type": "git",

- "url": "git+https://github.com/agentfront/frontmcp.git"

* "url": "git+https://github.com/agentfront/frontmcp.git",
* "directory": "libs/mcp-from-openapi"
  },
  "bugs": {
  "url": "https://github.com/agentfront/frontmcp/issues"
  @@ -42,13 +43,15 @@
  },
  "dependencies": {
  "@apidevtools/json-schema-ref-parser": "^11.5.4",

- "@types/json-schema": "^7.0.15",
  "openapi-types": "^12.1.3",
  "yaml": "^2.8.1"
  },

* "peerDependencies": {
* "zod": "^4.0.0"
* },
  "devDependencies": {

- "@types/node": "^22.0.0",

* "@types/node": "^24.0.0",
  "typescript": "^5.0.0",

- "zod": "^3.23.8"

* "zod": "^4.0.0"
  }
  }
  diff --git a/libs/mcp-from-openapi/src/index.ts b/libs/mcp-from-openapi/src/index.ts
  index ce2ec6c..faad1e3 100644
  --- a/libs/mcp-from-openapi/src/index.ts
  +++ b/libs/mcp-from-openapi/src/index.ts
  @@ -7,14 +7,7 @@ export { Validator } from './validator';
  export { SecurityResolver, createSecurityContext } from './security-resolver';

// Error exports
-export {

- OpenAPIToolError,
- LoadError,
- ParseError,
- ValidationError,
- GenerationError,
- SchemaError,
  -} from './errors';
  +export { OpenAPIToolError, LoadError, ParseError, ValidationError, GenerationError, SchemaError } from './errors';

// Type exports
export type {
@@ -78,4 +71,4 @@ export type {
} from './security-resolver';

// Utility exports
-export { isReferenceObject, toJSONSchema7 } from './types';
+export { isReferenceObject, toJsonSchema } from './types';
diff --git a/libs/mcp-from-openapi/src/parameter-resolver.ts b/libs/mcp-from-openapi/src/parameter-resolver.ts
index 39927f8..be65d94 100644
--- a/libs/mcp-from-openapi/src/parameter-resolver.ts
+++ b/libs/mcp-from-openapi/src/parameter-resolver.ts
@@ -1,4 +1,7 @@
-import type { JSONSchema7 } from 'json-schema';
+import type { JSONSchema } from 'zod/v4/core';

- +/\*_ JSON Schema type from Zod v4 _/
  +type JsonSchema = JSONSchema.JSONSchema;
  import type {
  ParameterMapper,
  ParameterObject,
  @@ -11,7 +14,7 @@ import type {
  SecurityParameterInfo,
  SecuritySchemeObject,
  } from './types';
  -import { toJSONSchema7, isReferenceObject } from './types';
  +import { toJsonSchema, isReferenceObject } from './types';
  /\*\*
  - Resolves parameters and handles naming conflicts
    @@ -28,11 +31,7 @@ export class ParameterResolver {
    /\*\*
    _ Default conflict resolver: prefix with location
    _/

* private defaultConflictResolver(
* paramName: string,
* location: ParameterLocation,
* index: number
* ): string {

- private defaultConflictResolver(paramName: string, location: ParameterLocation, index: number): string {
  const locationPrefix = {
  path: 'path',
  query: 'query',
  @@ -51,15 +50,12 @@ export class ParameterResolver {
  operation: any,
  pathParameters?: ParameterObject[],
  securityRequirements?: SecurityRequirement[],

* includeSecurityInInput?: boolean

- includeSecurityInInput?: boolean,
  ): {

* inputSchema: JSONSchema7;

- inputSchema: JsonSchema;
  mapper: ParameterMapper[];
  } {

* const allParameters: ParameterObject[] = [
*      ...(pathParameters ?? []),
*      ...(operation.parameters ?? []),
* ];

- const allParameters: ParameterObject[] = [...(pathParameters ?? []), ...(operation.parameters ?? [])];

  const requestBody = operation.requestBody as RequestBodyObject | undefined;

@@ -71,7 +67,7 @@ export class ParameterResolver {
const info: ParameterInfo = {
name: param.name,
location: param.in as ParameterLocation,

-        required: param.required ?? (param.in === 'path'),

*        required: param.required ?? param.in === 'path',
           schema: param.schema ?? { type: 'string' },
           description: param.description,
           style: param.style,
  @@ -92,17 +88,12 @@ export class ParameterResolver {
  const mediaType = requestBody.content[contentType];
         if (mediaType?.schema) {

-        this.extractBodyParameters(
-          mediaType.schema,
-          parametersByName,
-          requestBody.required ?? false,
-          contentType
-        );

*        this.extractBodyParameters(mediaType.schema, parametersByName, requestBody.required ?? false, contentType);
       }

  }

  // Resolve conflicts and build schema + mapper

- const properties: Record<string, JSONSchema7> = {};

* const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  const mapper: ParameterMapper[] = [];

@@ -129,11 +120,7 @@ export class ParameterResolver {
} else {
// Conflict - need to resolve
params.forEach((param, index) => {

-          const inputKey = this.namingStrategy.conflictResolver(
-            originalName,
-            param.location,
-            index
-          );

*          const inputKey = this.namingStrategy.conflictResolver(originalName, param.location, index);

             properties[inputKey] = this.buildParameterSchema(param);
             if (param.required) {
  @@ -160,11 +147,11 @@ export class ParameterResolver {
  properties,
  required,
  mapper,

-        includeSecurityInInput ?? false

*        includeSecurityInInput ?? false,
       );
  }

- const inputSchema: JSONSchema7 = {

* const inputSchema: JsonSchema = {
  type: 'object',
  properties,
  ...(required.length > 0 && { required }),
  @@ -182,12 +169,12 @@ export class ParameterResolver {
  parametersByName: Map<string, ParameterInfo[]>,
  required: boolean,
  contentType: string,

- prefix = ''

* prefix = '',
  ): void {
  if (!schema || typeof schema !== 'object') return;

- // Convert to JSONSchema7 for processing
- const jsonSchema = toJSONSchema7(schema);

* // Convert to JsonSchema for processing
* const jsonSchema = toJsonSchema(schema);
       // Handle object schemas
       if (jsonSchema.type === 'object' && jsonSchema.properties) {
  @@ -202,7 +189,7 @@ export class ParameterResolver {

For each library, respond with version bump recommendation and changelog.
The changelog should start with ## [NEW_VERSION] - 2025-12-11 and include appropriate sections.

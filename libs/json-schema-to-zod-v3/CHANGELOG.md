## [1.0.4] - 2025-12-27

### Changed

- Added `publish-alpha` Nx target to support alpha publishing via shared script.

## [1.0.3] - 2025-12-24

### Fixed

- Updated build pipeline to output both CJS and ESM bundles with proper export map and sideEffects flag for better tree shaking and package consumption paths.
- Adjusted package entry points and type declarations to align with new dist layout without changing runtime API.

## [1.0.2] - 2025-12-19

### Fixed

- Align Jest config with CommonJS export to ensure test runner compatibility.
- Adjust TypeScript build output and root directories for correct dist emission without affecting API.

### Chore

- Added resilience to end-to-end tests and improved test client context handling.
- Documented peer dependency alignment for zod.

## [1.0.1] - 2025-12-11

### Changed

- Updated SWC/Jest config to inline ES2022 settings and tightened test exclusions
- Added repository directory metadata and bumped @types/node dev dependency
- Expanded tsconfig exclusions for tests and utilities

# Changelog

## [1.0.0] - 2025-11-21

### Features

- Production-ready converter from JSON Schema (Draft 7+) to Zod v3 schemas
- Full TypeScript support with proper type inference
- Support for all common JSON Schema types (string, number, boolean, object, array, null)
- Advanced schema features:
  - String formats and patterns (email, uri, uuid, date-time, etc.)
  - Numeric constraints (minimum, maximum, multipleOf)
  - Array constraints (minItems, maxItems, uniqueItems)
  - Object properties with required/optional fields
  - Nested schemas and complex compositions
- Schema composition support (allOf, anyOf, oneOf, not)
- Reference resolution ($ref) for schema reusability
- Enum and const value handling
- Default value support
- Description and metadata preservation
- Validation of input schemas
- Comprehensive error handling

### Documentation

- Complete API documentation
- Usage examples and code samples
- TypeScript integration guide
- Migration notes from other schema converters

This is the first official release of `json-schema-to-zod-v3`, extracted from the FrontMCP framework to be published as
a standalone, reusable library for the community.

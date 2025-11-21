# Changelog

## [1.0.0] - 2025-11-21

### Features

- Production-ready library for converting OpenAPI specifications into MCP tool definitions
- OpenAPI 3.0+ and Swagger 2.0 support
- Comprehensive operation parsing:
  - RESTful endpoint detection (GET, POST, PUT, PATCH, DELETE, etc.)
  - Path parameter extraction and validation
  - Query parameter handling
  - Request body schema conversion
  - Response schema parsing
- Advanced OpenAPI features:
  - Reference resolution ($ref) across the entire specification
  - Security scheme detection and configuration
  - Parameter conflict resolution
  - Operation naming controls and customization
- Request mapper generation:
  - Automatic parameter mapping from MCP tool inputs to HTTP requests
  - Type-safe parameter handling
  - Support for different parameter locations (path, query, header, cookie)
  - Request body transformation
- Tool metadata generation:
  - Descriptive tool names from operation IDs
  - Documentation from OpenAPI descriptions
  - Schema validation rules
- Multiple input formats:
  - JSON OpenAPI specifications
  - YAML OpenAPI specifications
  - Inline specification objects
  - URL references to remote specifications
- Type-safe TypeScript implementation
- Node.js 18+ compatibility

### Documentation

- Complete API reference
- OpenAPI conversion examples
- Integration guides for MCP servers
- Best practices for tool generation

This is the first official release of `mcp-from-openapi`, extracted from the FrontMCP framework to be published as a
standalone, reusable library for the community.

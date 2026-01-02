# Changelog

## [0.1.0] - Initial Release

### Added

- Core DI container (`DiContainer`) with hierarchical provider support
- Token factory (`createTokenFactory`) with configurable prefix
- Provider normalizer factory (`createProviderNormalizer`)
- Registry base classes: `RegistryAbstract`, `IndexedRegistry`, `SimpleRegistry`
- Provider types: `ProviderKind`, `ProviderScope`, `ProviderRecord` variants
- Token types: `Token`, `Type`, `Reference`, `ClassToken`, `Abstract`
- Utility functions: `tokenName`, `isClass`, `depsOfClass`, etc.
- Metadata utilities: `getMetadata`, `setMetadata`, `hasAsyncWith`
- `@AsyncWith` decorator for async dependency resolution

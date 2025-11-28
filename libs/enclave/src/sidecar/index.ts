/**
 * Reference Sidecar Module
 *
 * Provides pass-by-reference support for the enclave execution environment.
 * Large data is stored in the sidecar with opaque reference IDs, and
 * references are resolved at the callTool boundary.
 *
 * @packageDocumentation
 */

// Configuration
export {
  ReferenceConfig,
  REFERENCE_CONFIGS,
  REF_ID_PREFIX,
  REF_ID_SUFFIX,
  REF_ID_PATTERN,
  isReferenceId,
  getReferenceConfig,
} from './reference-config';

// Sidecar
export {
  ReferenceSidecar,
  ReferenceSource,
  ReferenceMetadata,
  SidecarLimitError,
  ReferenceNotFoundError,
} from './reference-sidecar';

// Resolver
export { ReferenceResolver, ResolutionLimitError, CompositeHandle, isCompositeHandle } from './reference-resolver';

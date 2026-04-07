/**
 * Authorities — Built-in RBAC/ABAC/ReBAC authorization for FrontMCP.
 *
 * Importing from this module activates global interface augmentation
 * that adds the `authorities` field to all entry metadata types.
 */

// Side-effect: augment entry metadata interfaces
import './authorities.metadata-augment';

// Types
export type {
  RbacRolesPolicy,
  RbacPermissionsPolicy,
  AbacOperator,
  AbacCondition,
  AbacPolicy,
  DynamicValueRef,
  ResourceIdRef,
  RebacPolicy,
  AuthoritiesPolicyMetadata,
  AuthorityProfileName,
  AuthoritiesMetadata,
  AuthoritiesDenial,
  AuthoritiesResult,
  RelationshipResolver,
  AuthoritiesEvaluationContext,
  AuthoritiesEvaluator,
  AuthorityGuardFn,
} from './authorities.types';

// Profile config types
export type { AuthoritiesClaimsMapping, AuthoritiesConfig, AuthoritiesScopeMapping } from './authorities.profiles';

// Scope mapping
export { resolveRequiredScopes } from './authorities.scope-mapping';

// Zod schemas
export {
  rbacRolesPolicySchema,
  rbacPermissionsPolicySchema,
  abacOperatorSchema,
  abacConditionSchema,
  abacPolicySchema,
  resourceIdRefSchema,
  rebacPolicySchema,
  authoritiesPolicySchema,
  authoritiesMetadataSchema,
  authoritiesClaimsMappingSchema,
  authoritiesConfigSchema,
} from './authorities.schema';

// Evaluation engine
export { AuthoritiesEngine } from './authorities.engine';

// Context builder
export { AuthoritiesContextBuilder } from './authorities.context';
export type { ClaimsResolverFn } from './authorities.context';

// Registries
export { AuthoritiesEvaluatorRegistry, AuthoritiesProfileRegistry } from './authorities.registry';

// Errors
export { AuthorityDeniedError } from './authorities.errors';

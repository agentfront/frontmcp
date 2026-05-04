// file: libs/adapters/src/skills/index.ts
//
// Public surface of the Skills Adapter. Plugins (notably plugin-skilled-openapi)
// and hosts consume bundle sources, the bundle store, schemas, and security
// utilities from here. The adapter holds NO MCP execution logic — it's purely
// the loader/distribution layer.

// Bundle types & schemas
export type {
  AuthBinding,
  AuthoritiesPolicy,
  BundleIntegrity,
  BundledSkill,
  HttpMethod,
  OperationDescriptor,
  ResolvedBundle,
  ServiceDescriptor,
} from './bundle/bundle.types';
export { bundleSkillToActions } from './bundle/bundle.types';
export { crossValidate, resolvedBundleSchema, type ParsedBundle } from './bundle/bundle.schema';
export { OverlayParseError, parseOverlay, type OverlayInput } from './bundle/overlay-parser';
export { BundleStore, type BundleSwapListener } from './bundle/bundle.store';
export { diffBundles, formatDiffSummary, type BundleDiff } from './bundle/bundle-diff';

// Source configuration
export {
  bundleSourceSchema,
  npmSourceSchema,
  saasSourceSchema,
  signatureKeySchema,
  staticSourceSchema,
  type BundleSourceOptions,
  type NpmSourceOptions,
  type SaasSourceOptions,
  type SignatureKey,
  type StaticSourceOptions,
} from './source-options';

// Sources
export { createBundleSource, NpmSource, SaasPullSource, StaticSource } from './sources';
export type { BundleSourceListener, SkillBundleSource } from './sources/skill-bundle-source.interface';

// Security
export {
  bundleDigest,
  canonicalize,
  verifyBundleSignature,
  type SignatureVerifyResult,
} from './security/bundle-signature';
export { BundlePushJwtVerifier, type BundlePushJwtVerifierOptions } from './security/jwt-verifier';
export {
  WebhookReplayGuard,
  type ReplayCheckResult,
  type WebhookReplayGuardOptions,
} from './security/webhook-replay-guard';

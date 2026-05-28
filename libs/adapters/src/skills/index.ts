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
export {
  BundleStore,
  BundlePinnedError,
  type BundleStoreCounter,
  type BundleStoreOptions,
  type BundleStoreSpan,
  type BundleStoreTelemetry,
  type BundleSwapListener,
} from './bundle/bundle.store';
export { diffBundles, formatDiffSummary, type BundleDiff } from './bundle/bundle-diff';

// Dependency resolution
export {
  resolveSkillLoadOrder,
  SkillDependencyCycleError,
  SkillDependencyInvariantError,
  SkillDependencyMissingError,
} from './dependency/skill-dag';

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

// Filesystem skills source — produces SkillContent events for plain disk
// directories with hot reload (xmcp / mcp-skillset parity).
export {
  FilesystemSkillsSource,
  loadFilesystemSkill,
  parseSkillFrontmatter,
  type FilesystemSkillContent,
  type FilesystemSkillsEvent,
  type FilesystemSkillsListener,
  type FilesystemSkillsLogger,
  type FilesystemSkillsSourceOptions,
} from './sources/filesystem-skills.source';

// Security
export {
  bundleDigest,
  canonicalize,
  verifyBundleSignature,
  type SignatureVerifyCounter,
  type SignatureVerifyResult,
  type SignatureVerifyTelemetry,
} from './security/bundle-signature';
export { BundlePushJwtVerifier, type BundlePushJwtVerifierOptions } from './security/jwt-verifier';
export {
  WebhookReplayGuard,
  type ReplayCheckResult,
  type ReplayGuardCounter,
  type ReplayGuardTelemetry,
  type WebhookReplayGuardOptions,
} from './security/webhook-replay-guard';

// Audit log (tamper-evident, signed, hash-chained)
export {
  canonicalizeRecordForSigning,
  defaultAuditSignatureVerifier,
  Hs256AuditSigner,
  linkRecord,
  MemoryAuditStore,
  nextPrevHash,
  Rs256AuditSigner,
  SKILL_AUDIT_ERROR_MESSAGE_MAX,
  SKILL_AUDIT_GENESIS_PREV_HASH,
  SKILL_AUDIT_KEYS,
  SKILL_AUDIT_QUEUE_MAX,
  SkillAuditWriter,
  SkillAuditWriterToken,
  StorageAdapterAuditStore,
  verifyChain,
  type AuditChainVerifyResult,
  type AuditSignatureVerifier,
  type AuditTrustedKey,
  type SkillAuditAuthorityFailExtras,
  type SkillAuditConfig,
  type SkillAuditFailureExtras,
  type SkillAuditLogger,
  type SkillAuditMetrics,
  type SkillAuditPartialRecord,
  type SkillAuditPhase,
  type SkillAuditReadOptions,
  type SkillAuditRecord,
  type SkillAuditSignatureAlg,
  type SkillAuditSigner,
  type SkillAuditSignResult,
  type SkillAuditSubjectMode,
  type SkillAuditWriterOptions,
  type SkillAuditStore,
  type SkillAuditSuccessExtras,
  type SkillAuditWriteContext,
} from './audit';

// `setSkillAuditFactory` lives in the SDK (it registers the audit module
// against the SDK's lazy DI hook) but every documented integration path
// imports it alongside the audit signer/store classes from this barrel.
// Re-exporting here keeps the docs and the public surface in sync.
export { hasSkillAuditFactory, setSkillAuditFactory } from '@frontmcp/sdk';

// Markdown harvester for OpenAPI operation references — used by the deploy
// pipeline and the future LSP to surface `op://` and `[[op:...]]` mentions
// inside skill bundles. See `harvester/op-reference.ts` for the contract.
export {
  buildKnownOps,
  dedupeOpReferences,
  extractOpReferences,
  validateOpReferences,
  type KnownOps,
  type OpReference,
  type OpReferenceDiagnostic,
  type OpReferenceSyntax,
  type SourceLocation,
} from './harvester/op-reference';

// Declarative deploy manifest (frontmcp.deploy.yaml) — v1 schema + parser +
// cross-field validator. Consumed by the deploy CLI / GitHub Action to
// produce the signed envelope that the Worker hot-reloads from.
export {
  applyEnvironmentOverlay,
  crossValidateManifest,
  deployManifestSchema,
  type DeployManifest,
  type DeployManifestAuth,
  type DeployManifestBindings,
  type DeployManifestClassificationRule,
  type DeployManifestEnvironmentOverlay,
  type DeployManifestRuntime,
  type DeployManifestSecret,
  type DeployManifestServer,
  type DeployManifestSigning,
  type DeployManifestSkills,
} from './deploy/deploy-manifest.schema';

// OpenAPI -> MCP classifier. Pure build-time function: turns a list of
// operations into a per-op classification (tool/resource/both + notification
// emit target + URI template). Consumed by the deploy pipeline.
export {
  applyClassificationOverrides,
  classifyOne,
  classifyOperations,
  type ClassifiableHttpMethod,
  type ClassificationOverrideRule,
  type ClassifiedOperation,
  type ExposeKind,
  type InputOperation,
  type MutationEmit,
} from './classifier/openapi-classify';

// Runtime resource-change dispatcher. Pure-function URI renderer + a small
// in-memory registry of `${specId}.${operationId}` -> ClassifiedOperation
// the runtime hook consumes after every successful tool call.
export { renderResourceUri, type RenderResult } from './classifier/render-resource-uri';
export {
  buildResourceChangeNotification,
  type BuildNotificationResult,
  type ResourceChangeNotification,
  type ResourceUpdatedNotification,
  type ResourcesListChangedNotification,
  type SuppressedReason,
} from './classifier/resource-change-notification';
export { ClassificationRegistry, type ClassificationRegistrySnapshot } from './classifier/classification-registry';

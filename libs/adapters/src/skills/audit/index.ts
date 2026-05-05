// file: libs/adapters/src/skills/audit/index.ts
//
// Public surface of the skill audit log module. Imported via
// `@frontmcp/adapters/skills` by hosts wiring up custom signers/stores and
// by the SDK's skill scope helper for default registration.

export {
  SKILL_AUDIT_GENESIS_PREV_HASH,
  SKILL_AUDIT_KEYS,
  type SkillAuditPhase,
  type SkillAuditRecord,
  type SkillAuditSignatureAlg,
} from './audit-record.types';

export {
  canonicalizeRecordForSigning,
  linkRecord,
  nextPrevHash,
  verifyChain,
  type AuditChainVerifyResult,
  type AuditSignatureVerifier,
  type AuditTrustedKey,
  type SkillAuditPartialRecord,
} from './audit-chain';

export {
  defaultAuditSignatureVerifier,
  Hs256AuditSigner,
  Rs256AuditSigner,
  type SkillAuditSignResult,
  type SkillAuditSigner,
} from './audit-signer';

export {
  MemoryAuditStore,
  StorageAdapterAuditStore,
  type SkillAuditReadOptions,
  type SkillAuditStore,
} from './audit-store';

export {
  SkillAuditWriter,
  SKILL_AUDIT_ERROR_MESSAGE_MAX,
  SKILL_AUDIT_QUEUE_MAX,
  type SkillAuditAuthorityFailExtras,
  type SkillAuditFailureExtras,
  type SkillAuditLogger,
  type SkillAuditMetrics,
  type SkillAuditSuccessExtras,
  type SkillAuditWriteContext,
  type SkillAuditWriterOptions,
} from './audit-writer';

export { SkillAuditWriterToken, type SkillAuditConfig, type SkillAuditSubjectMode } from './audit-config';

import * as skillAuditModule from '@frontmcp/adapters/skills';
import { hasSkillAuditFactory, setSkillAuditFactory } from '@frontmcp/sdk';

/** Register the audit module so `skillsConfig.audit` works without `setSkillAuditFactory()`; a host's own is kept. */
export function registerSkillAuditModule(): void {
  if (!hasSkillAuditFactory()) setSkillAuditFactory(() => skillAuditModule);
}

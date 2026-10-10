import * as skillAuditModule from '@frontmcp/adapters/skills';
import { hasSkillAuditFactory, setSkillAuditFactory } from '@frontmcp/sdk';

/**
 * Register the skill audit module with the SDK, so `skillsConfig.audit` builds its writer without
 * the host calling `setSkillAuditFactory()`. A factory the host already registered is kept.
 */
export function registerSkillAuditModule(): void {
  if (!hasSkillAuditFactory()) setSkillAuditFactory(() => skillAuditModule);
}

// file: libs/sdk/src/skill/errors/skill-validation.error.ts

import { PublicMcpError, MCP_ERROR_CODES } from '../../errors';

/**
 * Result of validating a single skill's tool references.
 */
export interface SkillValidationResult {
  /**
   * Unique identifier of the skill.
   */
  skillId: string;

  /**
   * Name of the skill.
   */
  skillName: string;

  /**
   * Validation status.
   * - 'valid': All tools are available
   * - 'warning': Some tools are missing/hidden but validation mode is 'warn'
   * - 'failed': Tools are missing/hidden and validation mode is 'strict'
   */
  status: 'valid' | 'warning' | 'failed';

  /**
   * Tools that are referenced but not found in the registry.
   */
  missingTools: string[];

  /**
   * Tools that exist but are hidden (not visible to clients).
   */
  hiddenTools: string[];

  /**
   * Validation mode used for this skill.
   */
  validationMode: 'strict' | 'warn' | 'ignore';
}

/**
 * Report of validating all skills in a registry.
 */
export interface SkillValidationReport {
  /**
   * Validation results for each skill.
   */
  results: SkillValidationResult[];

  /**
   * Whether all skills passed validation (no 'failed' status).
   */
  isValid: boolean;

  /**
   * Total number of skills validated.
   */
  totalSkills: number;

  /**
   * Number of skills with 'failed' status.
   */
  failedCount: number;

  /**
   * Number of skills with 'warning' status.
   */
  warningCount: number;
}

/**
 * Error thrown when skill tool validation fails in strict mode.
 *
 * This error is thrown during skill registry initialization when:
 * 1. A skill references tools that don't exist in the tool registry
 * 2. The skill's toolValidation mode is 'strict'
 * 3. failOnInvalidSkills is enabled (registry-level)
 *
 * @example
 * ```typescript
 * try {
 *   await skillRegistry.validateAllTools();
 * } catch (error) {
 *   if (error instanceof SkillValidationError) {
 *     console.log('Failed skills:', error.failedSkills);
 *   }
 * }
 * ```
 */
export class SkillValidationError extends PublicMcpError {
  readonly mcpErrorCode = MCP_ERROR_CODES.INVALID_PARAMS;

  /**
   * Skills that failed validation.
   */
  readonly failedSkills: SkillValidationResult[];

  /**
   * Full validation report including all skills.
   */
  readonly report: SkillValidationReport;

  constructor(message: string, report: SkillValidationReport) {
    super(message);
    this.name = 'SkillValidationError';
    this.failedSkills = report.results.filter((r) => r.status === 'failed');
    this.report = report;
  }

  /**
   * Create a SkillValidationError from a validation report.
   */
  static fromReport(report: SkillValidationReport): SkillValidationError {
    const failedSkills = report.results.filter((r) => r.status === 'failed');
    const skillNames = failedSkills.map((s) => s.skillName).join(', ');
    const message =
      failedSkills.length === 1
        ? `Skill '${failedSkills[0].skillName}' failed tool validation: missing tools [${failedSkills[0].missingTools.join(', ')}]`
        : `${failedSkills.length} skill(s) failed tool validation: ${skillNames}`;

    return new SkillValidationError(message, report);
  }

  override getPublicMessage(): string {
    return this.message;
  }

  toJsonRpcError() {
    return {
      code: this.mcpErrorCode,
      message: this.getPublicMessage(),
      data: {
        failedSkills: this.failedSkills.map((s) => ({
          skillId: s.skillId,
          skillName: s.skillName,
          missingTools: s.missingTools,
          hiddenTools: s.hiddenTools,
        })),
        totalSkills: this.report.totalSkills,
        failedCount: this.report.failedCount,
        warningCount: this.report.warningCount,
      },
    };
  }
}

import { Type } from '@frontmcp/di';
import { SkillContext } from '../interfaces';
import { SkillMetadata } from '../metadata';
import type { ParsedPackageSpecifier } from '../../esm-loader/package-specifier';

/**
 * Kinds of skill records supported by the framework.
 */
export enum SkillKind {
  /**
   * Class-based skill defined with @Skill decorator.
   */
  CLASS_TOKEN = 'CLASS_TOKEN',

  /**
   * Inline skill object created with skill() helper.
   */
  VALUE = 'VALUE',

  /**
   * File-based skill loaded from a .skill.md or similar file.
   */
  FILE = 'FILE',

  /**
   * ESM-loaded skill from an npm package via esm.sh.
   */
  ESM = 'ESM',
}

/**
 * Record for class-based skills using @Skill decorator.
 */
export type SkillClassTokenRecord = {
  kind: SkillKind.CLASS_TOKEN;
  provide: Type<SkillContext>;
  metadata: SkillMetadata;
};

/**
 * Record for inline skill objects created with skill() helper.
 * The token is a Symbol used for registration.
 */
export type SkillValueRecord = {
  kind: SkillKind.VALUE;
  provide: symbol;
  metadata: SkillMetadata;
};

/**
 * Record for file-based skills loaded from external files.
 * Used by loaders (e.g., markdown loader) to register skills.
 */
export type SkillFileRecord = {
  kind: SkillKind.FILE;
  provide: symbol;
  metadata: SkillMetadata;
  /**
   * Path to the source file (for reloading/hot-reload support).
   */
  filePath: string;
};

/**
 * Record for ESM-loaded skills from npm packages.
 */
export type SkillEsmRecord = {
  kind: SkillKind.ESM;
  provide: string;
  specifier: ParsedPackageSpecifier;
  metadata: SkillMetadata;
};

/**
 * Union of all skill record types.
 */
export type SkillRecord = SkillClassTokenRecord | SkillValueRecord | SkillFileRecord | SkillEsmRecord;

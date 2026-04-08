/**
 * Global interface augmentation for authorities metadata.
 *
 * Adds the `authorities` field to all entry type metadata interfaces.
 * Entry-level Zod schemas use `.passthrough()` so the field is accepted at runtime.
 *
 * Server/app-level configuration (claimsMapping, profiles) is passed via
 * `AuthoritiesPlugin.init({ claimsMapping, profiles })`.
 *
 * Import this file (or anything from '@frontmcp/auth/authorities') to
 * activate the augmentation.
 */

import type { AuthoritiesMetadata } from './authorities.types';

declare global {
  interface ExtendFrontMcpToolMetadata {
    authorities?: AuthoritiesMetadata;
  }

  interface ExtendFrontMcpResourceMetadata {
    authorities?: AuthoritiesMetadata;
  }

  interface ExtendFrontMcpResourceTemplateMetadata {
    authorities?: AuthoritiesMetadata;
  }

  interface ExtendFrontMcpPromptMetadata {
    authorities?: AuthoritiesMetadata;
  }

  interface ExtendFrontMcpSkillMetadata {
    authorities?: AuthoritiesMetadata;
  }
}

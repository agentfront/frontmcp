// file: libs/cli/src/commands/skills/targets/glama.ts
//
// Glama marketplace submission payload. Glama's schema differs from Smithery:
// it groups everything under a `mcpServer` envelope and supports an
// explicit rating field.

import type { PublishableSkill } from './smithery';

export interface GlamaPayload {
  mcpServer: {
    name: string;
    description: string;
    repository?: string;
    license?: string;
    tags: string[];
    rating?: number;
    install: { type: string; reference?: string; command?: string };
  };
}

export function buildGlamaPayload(skill: PublishableSkill): GlamaPayload {
  return {
    mcpServer: {
      name: skill.name,
      description: skill.description,
      ...(skill.repository && { repository: skill.repository }),
      ...(skill.license && { license: skill.license }),
      tags: skill.tags ?? [],
      ...(skill.rating !== undefined && { rating: skill.rating }),
      install: {
        type: skill.install?.type ?? 'npm',
        ...(skill.install?.reference && { reference: skill.install.reference }),
        ...(skill.install?.command && { command: skill.install.command }),
      },
    },
  };
}

export const GLAMA_ENDPOINT = 'https://glama.ai/api/mcp/v1/servers/submit';

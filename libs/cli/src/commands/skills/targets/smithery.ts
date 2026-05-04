// file: libs/cli/src/commands/skills/targets/smithery.ts
//
// Map a catalog skill onto Smithery's marketplace submission shape. Pure
// function so tests can pin the payload structure. Network submission is
// the responsibility of the publish command itself.

export interface PublishableSkill {
  name: string;
  description: string;
  category?: string;
  tags?: string[];
  rating?: number;
  license?: string;
  repository?: string;
  install?: { type: 'npm' | 'git'; reference: string; command?: string };
}

export interface SmitheryPayload {
  qualifiedName: string;
  displayName: string;
  description: string;
  homepage?: string;
  license?: string;
  install: { type: string; command?: string; reference?: string };
  tags: string[];
  category: string;
}

/** Build the Smithery JSON payload for one skill. */
export function buildSmitheryPayload(skill: PublishableSkill): SmitheryPayload {
  return {
    qualifiedName: `frontmcp/${skill.name}`,
    displayName: skill.name,
    description: skill.description,
    ...(skill.repository && { homepage: skill.repository }),
    ...(skill.license && { license: skill.license }),
    install: {
      type: skill.install?.type ?? 'npm',
      ...(skill.install?.command && { command: skill.install.command }),
      ...(skill.install?.reference && { reference: skill.install.reference }),
    },
    tags: skill.tags ?? [],
    category: skill.category ?? 'general',
  };
}

/** Smithery submission endpoint. */
export const SMITHERY_ENDPOINT = 'https://smithery.ai/api/v1/registry/submit';

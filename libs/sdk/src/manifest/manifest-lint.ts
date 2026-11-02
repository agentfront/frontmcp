import { type InstructionsBudget } from '../common/types/options/instructions-budget';
import { type ServerManifest } from './server-manifest.schema';

export type ManifestFindingRule = 'missing-description' | 'instructions-over-budget' | 'description-over-budget';

export type ManifestEntryKind = 'tool' | 'resource' | 'resourceTemplate' | 'prompt' | 'skill';

export interface ManifestFinding {
  rule: ManifestFindingRule;
  message: string;
  /** The entry the finding is about; absent for the instructions. */
  entry?: { kind: ManifestEntryKind; name: string };
}

/** What a client is sent at `initialize` and `tools/list`, measured against the budget. */
export interface BudgetedSurface {
  instructions?: string;
  tools: ReadonlyArray<{ name: string; description?: string }>;
}

const ENTRY_LABELS: Record<ManifestEntryKind, string> = {
  tool: 'Tool',
  resource: 'Resource',
  resourceTemplate: 'Resource template',
  prompt: 'Prompt',
  skill: 'Skill',
};

/** The instructions and tool descriptions longer than the budget allows. */
export function findBudgetOverruns(surface: BudgetedSurface, budget: InstructionsBudget): ManifestFinding[] {
  const findings: ManifestFinding[] = [];
  const instructionsLength = surface.instructions?.length ?? 0;
  if (instructionsLength > budget.instructions) {
    findings.push({
      rule: 'instructions-over-budget',
      message:
        `The initialize instructions are ${instructionsLength} characters, over the instructionsBudget of ` +
        `${budget.instructions}. Some clients copy them into every tool's description: shorten \`instructions\`, ` +
        `or keep skillsConfig.injectInstructions at 'compact'.`,
    });
  }
  for (const tool of surface.tools) {
    const descriptionLength = tool.description?.length ?? 0;
    if (descriptionLength <= budget.toolDescription) continue;
    findings.push({
      rule: 'description-over-budget',
      entry: { kind: 'tool', name: tool.name },
      message:
        `Tool "${tool.name}" has a ${descriptionLength}-character description, over the ` +
        `instructionsBudget.toolDescription of ${budget.toolDescription}.`,
    });
  }
  return findings;
}

/**
 * Lint a server manifest: listed entries without a description, and, unless the budget is off, instructions and tool
 * descriptions over `instructionsBudget`.
 */
export function lintServerManifest(manifest: ServerManifest): ManifestFinding[] {
  const listedTools = manifest.tools.filter((tool) => tool.visibility === 'public');
  const described: Array<{ kind: ManifestEntryKind; name: string; description?: string }> = [
    ...listedTools.map((tool) => ({ kind: 'tool' as const, name: tool.name, description: tool.description })),
    ...manifest.resources.map((resource) => ({
      kind: 'resource' as const,
      name: resource.uri,
      description: resource.description,
    })),
    ...manifest.resourceTemplates.map((template) => ({
      kind: 'resourceTemplate' as const,
      name: template.uriTemplate,
      description: template.description,
    })),
    ...manifest.prompts.map((prompt) => ({
      kind: 'prompt' as const,
      name: prompt.name,
      description: prompt.description,
    })),
    ...manifest.skills
      .filter((skill) => skill.hidden !== true)
      .map((skill) => ({ kind: 'skill' as const, name: skill.name, description: skill.description })),
  ];
  const missing = described
    .filter((entry) => (entry.description ?? '').trim().length === 0)
    .map(
      (entry): ManifestFinding => ({
        rule: 'missing-description',
        entry: { kind: entry.kind, name: entry.name },
        message: `${ENTRY_LABELS[entry.kind]} "${entry.name}" has no description.`,
      }),
    );
  const overruns = manifest.budget
    ? findBudgetOverruns({ instructions: manifest.server.instructions, tools: listedTools }, manifest.budget)
    : [];
  return [...missing, ...overruns];
}

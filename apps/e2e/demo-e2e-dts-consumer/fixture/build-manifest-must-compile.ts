import 'reflect-metadata';

import {
  buildManifest,
  FrontMcp,
  lintServerManifest,
  SERVER_MANIFEST_FILE,
  serverManifestSchema,
  type FrontMcpConfigInput,
  type ManifestFinding,
  type ManifestTool,
  type ServerManifest,
} from '@frontmcp/sdk';

@FrontMcp({
  info: { name: 'dts-manifest', version: '1.0.0' },
  apps: [],
  serve: false,
  instructionsBudget: { instructions: 480, toolDescription: 800 },
})
export class BudgetedServer {}

export const budgetOff: FrontMcpConfigInput = {
  info: { name: 'off', version: '1.0.0' },
  apps: [],
  instructionsBudget: false,
};

export async function lintBudgeted(): Promise<ManifestFinding[]> {
  const manifest: ServerManifest = await buildManifest(BudgetedServer);
  const tools: ManifestTool[] = manifest.tools;
  const rules = lintServerManifest(manifest).map((finding) => finding.rule);
  const read = serverManifestSchema.parse(JSON.parse(`{}`));
  return tools.length > 0 && rules.length > 0 && read.manifestVersion === 1 && SERVER_MANIFEST_FILE.length > 0
    ? lintServerManifest(read)
    : [];
}

export const wordyBudget: FrontMcpConfigInput = {
  info: { name: 'wordy', version: '1.0.0' },
  apps: [],
  // @ts-expect-error a limit is a number of characters
  instructionsBudget: { instructions: '480' },
};

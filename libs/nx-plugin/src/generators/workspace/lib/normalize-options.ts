import type { WorkspaceGeneratorSchema } from '../schema.js';

export interface NormalizedWorkspaceOptions extends Required<WorkspaceGeneratorSchema> {
  workspaceRoot: string;
}

export function normalizeOptions(schema: WorkspaceGeneratorSchema): NormalizedWorkspaceOptions {
  return {
    name: schema.name,
    packageManager: schema.packageManager ?? 'npm',
    skipInstall: schema.skipInstall ?? false,
    skipGit: schema.skipGit ?? false,
    createSampleApp: schema.createSampleApp ?? true,
    workspaceRoot: schema.name,
  };
}

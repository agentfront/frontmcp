export interface WorkspaceGeneratorSchema {
  name: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
  skipInstall?: boolean;
  skipGit?: boolean;
  createSampleApp?: boolean;
}

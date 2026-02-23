export interface WorkspaceGeneratorSchema {
  name: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  skipInstall?: boolean;
  skipGit?: boolean;
  createSampleApp?: boolean;
}

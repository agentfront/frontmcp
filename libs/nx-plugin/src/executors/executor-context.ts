/**
 * Minimal ExecutorContext type to avoid importing @nx/devkit at runtime in executor files.
 * The full type is only needed at build time.
 */
export interface ExecutorContext {
  root: string;
  cwd: string;
  projectName?: string;
  isVerbose: boolean;
  projectsConfigurations?: {
    version: number;
    projects: Record<string, { root: string; sourceRoot?: string }>;
  };
  projectGraph: unknown;
  nxJsonConfiguration: unknown;
}

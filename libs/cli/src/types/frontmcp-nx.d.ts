/**
 * Ambient module declaration for @frontmcp/nx.
 * This package is dynamically imported at runtime only when `create --nx` is used.
 * The full types live in the nx-plugin package; this declaration avoids a
 * build-time dependency from cli → nx-plugin.
 */
declare module '@frontmcp/nx' {
  export function workspaceGenerator(
    tree: import('nx/src/generators/tree').Tree,
    schema: {
      name: string;
      packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun';
      skipInstall?: boolean;
      skipGit?: boolean;
      createSampleApp?: boolean;
    },
  ): Promise<(() => void | Promise<void>) | undefined>;
}

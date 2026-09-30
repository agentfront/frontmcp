export interface AppGeneratorSchema {
  name: string;
  directory?: string;
  /** Set when the tree root is above the Nx workspace (the `workspace` generator scaffolds into `<name>/`). */
  workspaceRoot?: string;
  tags?: string;
  skipFormat?: boolean;
}

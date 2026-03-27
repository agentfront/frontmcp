export interface SkillDirGeneratorSchema {
  name: string;
  project: string;
  description?: string;
  directory?: string;
  tags?: string;
  withReferences?: boolean;
  skipFormat?: boolean;
}

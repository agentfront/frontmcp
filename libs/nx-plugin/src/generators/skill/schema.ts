export interface SkillGeneratorSchema {
  name: string;
  project: string;
  tools?: string;
  directory?: string;
  skipFormat?: boolean;
}

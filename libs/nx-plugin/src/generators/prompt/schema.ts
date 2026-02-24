export interface PromptGeneratorSchema {
  name: string;
  project: string;
  arguments?: string;
  directory?: string;
  skipFormat?: boolean;
}
